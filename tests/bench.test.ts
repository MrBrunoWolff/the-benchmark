/**
 * Black-box tests for bench.mjs.
 *
 * bench.mjs is deliberately a single zero-dependency file that must keep running
 * under plain `node` (it is published to npm and entered via `npx`), so nothing
 * here changes it — not even to export internals for testability. Instead these
 * drive the real CLI as a subprocess against a mock OpenAI-compatible server,
 * which is what the tool talks to anyway.
 *
 * Bun is only the *test* runtime: Bun.serve stands up the mock, and each case
 * runs the CLI under both `bun` and `node` so a Bun-only regression cannot slip
 * into a file whose whole contract is Node compatibility.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BENCH = join(import.meta.dir, "..", "bench.mjs");
const RUNTIMES = ["bun", "node"] as const;

/** One SSE frame in the shape the streaming parser expects. */
const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

let server: ReturnType<typeof Bun.serve>;
let base: string;
/** Bodies the CLI posted, so tests can assert on what it actually asked for. */
let requests: Array<Record<string, unknown>> = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);

      // LM Studio's native endpoint, which the CLI prefers so it can pick a
      // model that is already loaded rather than the first one listed.
      if (pathname === "/api/v0/models") {
        return Response.json({
          data: [
            { id: "an-embedding-model", state: "loaded", type: "embeddings" },
            { id: "not-loaded-model", state: "not-loaded", type: "llm" },
            { id: "loaded-model", state: "loaded", type: "llm" },
          ],
        });
      }

      if (pathname === "/v1/models") {
        return Response.json({ data: [{ id: "fallback-model" }] });
      }

      if (pathname === "/v1/chat/completions") {
        requests.push((await req.json()) as Record<string, unknown>);
        const stream = new ReadableStream({
          start(controller) {
            const send = (s: string) => controller.enqueue(new TextEncoder().encode(s));
            // A thinking delta first: it must start the TTFT clock too.
            send(sse({ choices: [{ delta: { reasoning_content: "hmm" } }] }));
            for (const word of ["Hello", " from", " the", " mock"]) {
              send(sse({ choices: [{ delta: { content: word } }] }));
            }
            send(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
            send(
              sse({
                choices: [],
                usage: { prompt_tokens: 256, completion_tokens: 4, total_tokens: 260 },
              }),
            );
            send("data: [DONE]\n\n");
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }

      return new Response("not found", { status: 404 });
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => server?.stop(true));

async function runBench(runtime: string, args: string[], out?: string) {
  const dir = out ?? mkdtempSync(join(tmpdir(), "bench-test-"));
  const proc = Bun.spawn([runtime, BENCH, "--url", base, "--out", dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    // The CLI prompts interactively when it cannot decide on a backend; --url
    // avoids that, and a closed stdin makes a regression hang-free rather than
    // hanging the suite.
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode, dir };
}

describe.each(RUNTIMES)("under %s", (runtime) => {
  test("runs the prefill phase and reports throughput", async () => {
    requests = [];
    const { stdout, exitCode } = await runBench(runtime, [
      "--phases", "prefill",
      "--runs", "1",
      "--sizes", "256",
    ]);

    expect(exitCode, stdout).toBe(0);
    // The prefill table reports tokens/s per size; the header is the contract.
    expect(stdout).toContain("prefill");
    expect(stdout).toMatch(/tok\/s/i);
    expect(requests.length).toBeGreaterThan(0);
  }, 60_000);

  test("streams with usage accounting requested", async () => {
    requests = [];
    await runBench(runtime, ["--phases", "prefill", "--runs", "1", "--sizes", "256"]);

    const body = requests[0]!;
    expect(body.stream).toBe(true);
    // Without include_usage the token counts every metric divides by never arrive.
    expect(body.stream_options).toEqual({ include_usage: true });
    // Benchmarks must be deterministic.
    expect(body.temperature).toBe(0);
  }, 60_000);

  test("prefers an already-loaded LM Studio model over the first listed", async () => {
    const { stdout } = await runBench(runtime, [
      "--phases", "prefill",
      "--runs", "1",
      "--sizes", "256",
    ]);
    // /api/v0/models offers a loaded LLM, a not-loaded one, and a loaded
    // embedding model. Only the first is a valid choice.
    expect(stdout).toContain("loaded-model");
    expect(stdout).not.toContain("fallback-model");
    expect(stdout).not.toContain("an-embedding-model");
  }, 60_000);

  test("honours an explicit --model", async () => {
    requests = [];
    await runBench(runtime, [
      "--phases", "prefill",
      "--runs", "1",
      "--sizes", "256",
      "--model", "explicitly-chosen",
    ]);
    expect(requests[0]!.model).toBe("explicitly-chosen");
  }, 60_000);

  test("rejects an unknown phase instead of silently doing nothing", async () => {
    const { stderr, exitCode } = await runBench(runtime, ["--phases", "nonsense"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown phase "nonsense"');
    // The message has to name the valid options to be actionable.
    expect(stderr).toContain("prefill");
    expect(stderr).toContain("generation");
    expect(stderr).toContain("agentic");
  }, 30_000);

  test("rejects an unknown --target", async () => {
    // --target is only consulted when --url is absent, so call the CLI directly.
    const proc = Bun.spawn([runtime, BENCH, "--target", "nope"], {
      stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown target "nope"');
  }, 30_000);

  test("writes a run report under --out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-out-"));
    try {
      const { exitCode, stdout } = await runBench(
        runtime,
        ["--phases", "prefill", "--runs", "1", "--sizes", "256"],
        dir,
      );
      expect(exitCode, stdout).toBe(0);
      const runs = readdirSync(dir).filter((n) => n.startsWith("run-"));
      expect(runs.length).toBe(1);
      expect(readdirSync(join(dir, runs[0]!))).toContain("report.html");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("emits machine-readable results with --json", async () => {
    const { stdout, exitCode } = await runBench(runtime, [
      "--phases", "prefill",
      "--runs", "1",
      "--sizes", "256",
      "--json",
    ]);
    expect(exitCode, stdout).toBe(0);
    // The JSON blob is appended after the human tables, so parse the last object.
    const start = stdout.lastIndexOf("\n{");
    expect(start).toBeGreaterThan(-1);
    const parsed = JSON.parse(stdout.slice(start));
    expect(parsed.base).toBe(base);
    expect(Array.isArray(parsed.results)).toBe(true);
  }, 60_000);
});
