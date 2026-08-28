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
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
/**
 * How many completions were streaming at the same moment. The concurrency phase
 * makes a claim the other phases do not — that its requests genuinely overlap —
 * and a mock that answers instantly would let a sequential loop pass as parallel.
 */
let inflight = 0;
let maxInflight = 0;

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
        const body = (await req.json()) as Record<string, unknown>;
        requests.push(body);
        const system = String(
          (body.messages as Array<{ role: string; content: string }> | undefined)?.[0]?.content ?? "",
        );
        // The gallery planner asks for JSON and the SVG scenario asks for an svg
        // element; both paths are only exercised if the mock plays along.
        const words = /JSON array/i.test(system)
          ? [JSON.stringify([{ name: "Planned one", instruction: "draw one" }, { name: "Planned two", instruction: "draw two" }])]
          : /SVG artist/i.test(system)
            ? ['<svg viewBox="0 0 200 200"><script>alert(1)</script><rect onclick="x()" width="200" height="200" fill="#48f"/></svg>']
            : ["Hello", " from", " the", " mock"];
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        // Long enough that overlapping requests actually overlap, short enough
        // that the phases which fire dozens of them stay fast.
        await Bun.sleep(40);
        const stream = new ReadableStream({
          async start(controller) {
            const send = (s: string) => controller.enqueue(new TextEncoder().encode(s));
            // A thinking delta first: it must start the TTFT clock too.
            send(sse({ choices: [{ delta: { reasoning_content: "hmm" } }] }));
            for (const word of words) {
              send(sse({ choices: [{ delta: { content: word } }] }));
              await Bun.sleep(5);
            }
            send(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
            send(
              sse({
                choices: [],
                usage: { prompt_tokens: 256, completion_tokens: words.length, total_tokens: 256 + words.length },
              }),
            );
            send("data: [DONE]\n\n");
            inflight--;
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

  test("names the concurrent phase among the valid ones", async () => {
    const { stderr } = await runBench(runtime, ["--phases", "nonsense"]);
    expect(stderr).toContain("concurrent");
  }, 30_000);

  test("rejects an unknown --scenario before doing any work", async () => {
    const { stderr, exitCode } = await runBench(runtime, [
      "--phases", "concurrent",
      "--scenario", "nonsense",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown --scenario "nonsense"');
    expect(stderr).toContain("svg");
  }, 30_000);

  test("sweeps concurrency levels and reports aggregate against per-slot speed", async () => {
    const { stdout, exitCode } = await runBench(runtime, [
      "--phases", "concurrent",
      "--concurrency", "1,4",
      "--conc-tokens", "16",
    ]);
    expect(exitCode, stdout).toBe(0);
    // Both throughput columns have to be present: one of them alone is the
    // misreading this phase exists to prevent.
    expect(stdout).toContain("agg_tok/s");
    expect(stdout).toContain("slot_tok/s");
    // The sweep is only a sweep if every level actually ran.
    expect(stdout).toMatch(/^\s+1\s/m);
    expect(stdout).toMatch(/^\s+4\s/m);
    expect(stdout).toMatch(/knee at \d+ slots?/);
  }, 60_000);

  test("actually puts requests in flight together rather than looping", async () => {
    maxInflight = 0;
    inflight = 0;
    const { exitCode, stdout } = await runBench(runtime, [
      "--phases", "concurrent",
      "--concurrency", "4",
      "--conc-tokens", "16",
      // The latency floor and warmup are deliberately serial; leaving the floor
      // out keeps this assertion about the phase and nothing else.
      "--latency-mode", "none",
    ]);
    expect(exitCode, stdout).toBe(0);
    expect(maxInflight).toBe(4);
  }, 60_000);

  test("runs a gallery scenario and renders what each slot produced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-gallery-"));
    try {
      const { stdout, exitCode } = await runBench(
        runtime,
        ["--phases", "concurrent", "--scenario", "svg", "--concurrency", "2", "--tasks", "3", "--topic", "robots"],
        dir,
      );
      expect(exitCode, stdout).toBe(0);
      // Two of the three tasks come from the planner's JSON, the third from the
      // deterministic fallback — the report has to say so rather than imply the
      // model planned everything.
      expect(stdout).toContain("2 planned");
      const runs = readdirSync(dir).filter((n) => n.startsWith("run-"));
      const html = readFileSync(join(dir, runs[0]!, "report.html"), "utf8");
      expect(html).toContain("SVG gallery");
      expect(html).toContain("Planned one");
      expect(html).toContain("<svg");
      // Model output is embedded verbatim into a file the user opens in a
      // browser, so the two things that make an SVG executable must be gone.
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("onclick");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("reports how many slots were really streaming at once", async () => {
    // Its own server rather than the shared mock: that one answers in about 20ms,
    // and over a window that short the scheduler's jitter is most of the
    // measurement. Overlap is a claim about wall-clock alignment, so it needs a
    // decode window long enough for alignment to mean something.
    const batching = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/v1/models") return Response.json({ data: [{ id: "batching-model" }] });
        if (pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
        await req.json();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (s: string) => controller.enqueue(new TextEncoder().encode(s));
            for (let i = 0; i < 12; i++) {
              send(sse({ choices: [{ delta: { content: `tok${i} ` } }] }));
              await Bun.sleep(20);
            }
            send(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
            send(sse({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 12 } }));
            send("data: [DONE]\n\n");
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const dir = mkdtempSync(join(tmpdir(), "bench-overlap-"));
      const proc = Bun.spawn(
        [runtime, BENCH, "--url", `http://localhost:${batching.port}`, "--out", dir,
          "--phases", "concurrent", "--concurrency", "4", "--conc-tokens", "16",
          "--latency-mode", "none", "--json"],
        { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
      );
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode, stdout).toBe(0);
      expect(stdout).toContain("overlap");
      const parsed = JSON.parse(stdout.slice(stdout.lastIndexOf("\n{")));
      const level = parsed.results.find((r: { phase: string }) => r.phase === "concurrent");
      // Four asked for, four streaming: the tail where slots finish at slightly
      // different moments is the only thing keeping this under 4.
      expect(level.overlap).toBeGreaterThan(3);
      // And the serialisation warning must stay quiet on a server that batches.
      expect(stdout).not.toContain("WARNING");
      rmSync(dir, { recursive: true, force: true });
    } finally {
      batching.stop(true);
    }
  }, 60_000);

  test("warns when the server serialised the requests instead of batching them", async () => {
    // A server that only ever streams one response at a time is what an
    // unconfigured llama-server or Ollama looks like, and its aggregate tok/s
    // still rises with slot count — so the warning, not the throughput curve, is
    // what has to catch it.
    let chain: Promise<void> = Promise.resolve();
    const queueing = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/v1/models") return Response.json({ data: [{ id: "serial-model" }] });
        if (pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
        await req.json();
        const mine = chain.then(() => {});
        chain = chain.then(() => Bun.sleep(120));
        await mine;
        const stream = new ReadableStream({
          async start(controller) {
            const send = (s: string) => controller.enqueue(new TextEncoder().encode(s));
            for (const word of ["one", " at", " a", " time"]) {
              send(sse({ choices: [{ delta: { content: word } }] }));
              await Bun.sleep(25);
            }
            send(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
            send(sse({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 4 } }));
            send("data: [DONE]\n\n");
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const dir = mkdtempSync(join(tmpdir(), "bench-serial-"));
      const proc = Bun.spawn(
        [runtime, BENCH, "--url", `http://localhost:${queueing.port}`, "--out", dir,
          "--phases", "concurrent", "--concurrency", "4", "--conc-tokens", "16", "--latency-mode", "none"],
        { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
      );
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode, stdout).toBe(0);
      expect(stdout).toContain("WARNING");
      expect(stdout).toMatch(/one after another/);
      // And it has to name the fix, not just the symptom.
      expect(stdout).toContain("OLLAMA_NUM_PARALLEL");
      const runs = readdirSync(dir).filter((n) => n.startsWith("run-"));
      const html = readFileSync(join(dir, runs[0]!, "report.html"), "utf8");
      expect(html).toContain("did not run these in parallel");
      rmSync(dir, { recursive: true, force: true });
    } finally {
      queueing.stop(true);
    }
  }, 60_000);
});
