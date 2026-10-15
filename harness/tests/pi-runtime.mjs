// Opt-in, offline integration fixture. Run inside the pinned Pi image; no model
// server is contacted. The fake provider always writes deterministic tool calls.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = mkdtempSync(join(tmpdir(), 'benchmark-pi-runtime-'));
const extension = readFileSync(new URL('../pi-extension.mjs', import.meta.url), 'utf8');
try {
  for (const scenario of ['turn-cap', 'natural-completion', 'provider-error']) {
    const directory = join(root, scenario), config = join(directory, 'config'), app = join(directory, 'app');
    mkdirSync(config, { recursive: true }); mkdirSync(app);
    const requests = [];
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      requests.push(JSON.parse(raw));
      if (scenario === 'provider-error' && requests.length === 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'fixture provider failure', type: 'invalid_request_error' } }));
      }
      const done = (scenario === 'natural-completion' && requests.length === 2) || requests.length > 3;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish_reason = null, usage) => res.write('data: ' + JSON.stringify({
        id: 'fixture-' + requests.length, object: 'chat.completion.chunk', created: 0, model: 'fixture',
        choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
      }) + '\n\n');
      send({ role: 'assistant' });
      if (done) send({ content: 'Done.' });
      else send({ tool_calls: [{ index: 0, id: 'call_' + requests.length, type: 'function', function: {
        name: 'write', arguments: JSON.stringify({ path: join(app, 'artifact.txt'), content: 'turn-' + requests.length }),
      } }] });
      send({}, done ? 'stop' : 'tool_calls', { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
      res.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      writeFileSync(join(config, 'models.json'), JSON.stringify({ providers: { 'benchmark-local': {
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only', api: 'openai-completions',
        models: [{ id: 'fixture', reasoning: false, input: ['text'], contextWindow: 8192, maxTokens: 256,
          samplingParams: { temperature: 0 }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { maxTokensField: 'max_tokens', supportsStore: false, requiresToolResultName: true, requiresAssistantAfterToolResult: true } }],
      } } }));
      writeFileSync(join(config, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
      const file = join(config, 'budget.mjs');
      writeFileSync(file, extension + '\nexport default pi => configureBenchmark(pi, {maxTurns:2,reasoning:"none"});\n');
      const child = spawn('bash', ['-c', 'exec "$@" 2>&1', 'fixture-pi', 'pi', '--print', '--mode', 'json', '--no-extensions', '--no-skills', '--no-prompt-templates',
        '--extension', file, '--session-dir', join(directory, 'sessions'), '--provider', 'benchmark-local',
        '--model', 'fixture', '--thinking', 'off', 'Write the requested artifact.'], {
        cwd: app, env: { ...process.env, PI_CODING_AGENT_DIR: config }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      clearTimeout(timer);
      assert.equal(code, 0, stderr + '\n' + stdout.slice(-3000));
      const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      assert.equal(requests.length, 2, scenario + ': extra provider request after boundary\n' + stderr + '\n' + stdout.slice(0, 2200));
      assert(requests.every(r => r.reasoning_effort === 'none' && r.max_tokens === 256 && r.temperature === 0));
      assert.equal(readFileSync(join(app, 'artifact.txt'), 'utf8'), scenario === 'turn-cap' ? 'turn-2' : 'turn-1');
      const errors = events.filter(e => e.type === 'message_end' && e.message?.stopReason === 'error');
      assert.equal(errors.length, scenario === 'natural-completion' ? 0 : 1);
      if (scenario === 'turn-cap') assert.equal(errors[0].message.errorMessage, 'This operation was aborted');
      const caps = events.filter(e => e.type === 'benchmark_budget');
      assert.equal(caps.length, scenario === 'turn-cap' ? 1 : 0);
      console.log(JSON.stringify({ scenario, requests: requests.length, cleanExit: true,
        artifactRetained: true, reasoningEffort: requests[0].reasoning_effort,
        budgetMarkers: caps.length, expectedBudgetAborts: scenario === 'turn-cap' ? errors.length : 0,
        providerErrors: scenario === 'provider-error' ? errors.length : 0 }));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
} finally { rmSync(root, { recursive: true, force: true }); }
