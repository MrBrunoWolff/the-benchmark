import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BENCH = resolve(import.meta.dir, '../bench.mjs');
const KEY = 'test-only-secret-should-never-appear';
let server: ReturnType<typeof Bun.serve>;
let base: string;
let mode = 'good';
let requests: { path: string; auth: string | null; body: any }[] = [];

beforeAll(() => {
  server = Bun.serve({ port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = await req.json();
    requests.push({ path, body, auth: req.headers.get('authorization') });
    if (mode === 'unauthorized' && path === '/v1/systemone') return new Response(KEY, { status: 401 });
    if (mode === 'timeout') { await Bun.sleep(100); return Response.json({}); }
    const local = path === '/v1/chat/completions';
    const input = local ? JSON.parse(body.messages[1].content) : body;
    const text = input.state;
    const answers: Record<string, unknown> = {
      department: { type: 'choice', choice: text.includes('billed') ? 'billing' : text.includes('plan cost') ? 'sales' : 'technical' },
      impact: { type: 'score', score: text.includes('All work') ? 2 : text.includes('PDF') ? 1 : 0 },
      refund: { type: 'noul', noul: text.includes('Please refund') ? 1 : 0 },
    };
    if (mode === 'partial') delete answers.refund;
    if (mode === 'invalid') { answers.impact = { type: 'score', score: 99 }; answers.refund = { type: 'noul', noul: '1' }; }
    if (mode === 'echo') answers.extra = KEY;
    return Response.json(local ? {
      model: 'local-resolved', choices: [{ message: { content: mode === 'malformed' ? 'not JSON' : JSON.stringify({ answers }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 25 },
    } : { model: 'jev-resolved', answers, usage: { input_tokens: 80, output_tokens: 10 } });
  } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

async function run(runtime: string, args: string[] = [], key = KEY, file = false) {
  const dir = mkdtempSync(join(tmpdir(), 'system-one-'));
  if (file) writeFileSync(join(dir, '.env.local'), `# local secret\nTYPESAFE_API_KEY="${KEY}"\n`);
  const proc = Bun.spawn([runtime, BENCH, '--phases', 'system-one', '--url', base, '--model', 'mock-local', '--jev-url', base, '--runs', '1', '--out', join(dir, 'out'), '--json', ...args], {
    cwd: dir, env: { ...process.env, TYPESAFE_API_KEY: key }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  let result: any, html = '';
  try {
    const out = join(dir, 'out', readdirSync(join(dir, 'out'))[0]!);
    result = JSON.parse(readFileSync(join(out, 'system-one.json'), 'utf8'));
    html = readFileSync(join(out, 'report.html'), 'utf8');
  } catch { /* failed before reporting */ }
  rmSync(dir, { recursive: true, force: true });
  return { stdout, stderr, code, result, html };
}

describe.each(['bun', 'node'])('System One under %s', (runtime) => {
  test('same states/questions, native Jev auth, local JSON, independent model names, and persisted report', async () => {
    mode = 'good'; requests = [];
    const r = await run(runtime);
    expect(r.code, r.stderr).toBe(0);
    expect(requests).toHaveLength(8);
    const local = requests.filter((r) => r.path === '/v1/chat/completions');
    const jev = requests.filter((r) => r.path === '/v1/systemone');
    expect(local.every((r) => r.auth === 'Bearer bench' && r.body.model === 'mock-local' && r.body.stream === false)).toBe(true);
    expect(jev.every((r) => r.auth === `Bearer ${KEY}` && r.body.model === 'jev-latest')).toBe(true);
    for (let i = 0; i < local.length; i++) {
      const payload = JSON.parse(local[i]!.body.messages[1].content);
      expect(payload).toEqual({ state: jev[i]!.body.state, questions: jev[i]!.body.questions });
      expect(jev[i]!.body.expected).toBeUndefined();
    }
    expect(r.result.summaries.every((s: any) => s.accuracyPct === 100 && s.failed === 0 && s.scoreMae === 0 && s.noulBrier === 0)).toBe(true);
    expect(r.result.samples[0].inputTokens).toBe(100);
    expect(r.html).toContain('System One');
    expect(r.stdout + r.html + JSON.stringify(r.result)).not.toContain(KEY);
  });

  test('Jev-only needs no local discovery; quoted .env.local supplies key', async () => {
    mode = 'good'; requests = [];
    const r = await run(runtime, ['--system-one-providers', 'jev'], '', true);
    expect(r.code, r.stderr).toBe(0);
    expect(requests.every((r) => r.path === '/v1/systemone')).toBe(true);
    expect(r.stdout).not.toContain('warmup...');
  });

  test('local-only works without a key and never contacts Jev', async () => {
    mode = 'good'; requests = [];
    const r = await run(runtime, ['--system-one-providers', 'local'], '');
    expect(r.code, r.stderr).toBe(0);
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.path === '/v1/chat/completions')).toBe(true);
  });

  test('missing key fails before making requests', async () => {
    requests = [];
    const r = await run(runtime, [], '');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('TYPESAFE_API_KEY');
    expect(requests).toHaveLength(0);
  });

  test.each(['partial', 'invalid', 'malformed', 'unauthorized'])('%s counts failures and retains the other provider results', async (failure) => {
    mode = failure; requests = [];
    const r = await run(runtime);
    expect(r.code).toBe(1);
    expect(r.result.summaries.some((s: any) => s.failed === 4)).toBe(true);
    expect(r.result.samples).toHaveLength(8);
    expect(r.stdout + JSON.stringify(r.result)).not.toContain(KEY);
    if (failure === 'partial') expect(r.result.summaries[0].accuracyPct).toBeCloseTo(200 / 3);
    if (failure === 'malformed') expect(r.result.summaries[1].accuracyPct).toBe(100);
  });

  test('deadlines cover response bodies and report timeouts without retries', async () => {
    mode = 'timeout'; requests = [];
    const r = await run(runtime, ['--turn-timeout', '0.02', '--system-one-providers', 'jev']);
    expect(r.code).toBe(1);
    expect(r.result.samples.every((s: any) => s.error.includes('timeout'))).toBe(true);
    expect(r.result.summaries[0].medianMs).toBeNull();
  });

  test('successful responses cannot echo the credential into reports', async () => {
    mode = 'echo';
    const r = await run(runtime);
    expect(r.code).toBe(0);
    expect(r.stdout + r.html + JSON.stringify(r.result)).not.toContain(KEY);
  });

  test.each([['--runs', '0'], ['--system-one-providers', 'oops'], ['--turn-timeout', 'NaN'], ['--jev-url', 'http://example.com']])('validates %s', async (flag, value) => {
    requests = [];
    const r = await run(runtime, [flag, value]);
    expect(r.code).toBe(1);
    expect(requests).toHaveLength(0);
  });
});
