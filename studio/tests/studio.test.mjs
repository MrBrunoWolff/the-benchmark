import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, parseConfig, localEndpoint, containerEndpoint, harborConfig } from '../lib/config.mjs';
import { summarize, taskResults, parseSpeedOutput } from '../lib/results.mjs';
import { RunManager, discoverModels } from '../lib/runner.mjs';
import { createActions } from '../actions.mjs';
import { startServer } from '../server.mjs';

test('local-only configuration rejects remote URLs, credentials, cloud IDs and invalid budgets', () => {
  for (const endpoint of ['https://example.com', 'http://localhost.example.com', 'file:///tmp/a', 'http://user:secret@localhost:1234', 'http://localhost:1234/other', 'http://localhost:1234?key=secret']) assert.throws(() => localEndpoint(endpoint));
  assert.equal(localEndpoint('http://localhost:11434/v1/'), 'http://localhost:11434');
  assert.equal(containerEndpoint('http://127.0.0.1:1234/v1'), 'http://host.docker.internal:1234/v1');
  assert.throws(() => parseConfig({ kind: 'tasks', model: 'muse', maxTokens: 4096, contextWindow: 4096 }));
  assert.throws(() => parseConfig({ kind: 'tasks', model: 'muse', repeats: 0 }));
  assert.throws(() => parseConfig({ kind: 'tasks', model: 'muse', tasks: ['unknown'] }));
});

test('Harbor jobs use separate attempts, fixed budgets, no retries and the exact selected endpoint', () => {
  const config = parseConfig({ kind: 'tasks', model: 'future-model:8b', endpoint: 'http://localhost:1234', repeats: 3, tasks: ['csv-parser'], maxTurns: 7 });
  const job = harborConfig(config, 'example');
  assert.equal(job.n_attempts, 3); assert.equal(job.n_concurrent_trials, 1);
  assert.equal(job.agents[0].kwargs.max_turns, 7);
  assert.equal(job.agents[0].env.OPENAI_BASE_URL, 'http://host.docker.internal:1234/v1');
  assert.equal(job.agents[0].model_name, 'openai/future-model:8b');
  assert.equal(job.retry.max_retries, 0);
  assert.equal(job.tasks.length, 1);
});

test('grading distinguishes self-reported completion, failures, missing grades and setup errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'benchmark-results-'));
  try {
    const samples = [
      ['pass', { verifier_result: { rewards: { reward: 1 } }, agent_result: { n_input_tokens: 300, n_output_tokens: 50 } }],
      ['fail', { verifier_result: { rewards: { reward: 0 } } }],
      ['self-reported', {}],
      ['setup', { exception_info: { exception_type: 'BuildError', exception_message: 'broken image' } }],
      ['timeout', { exception_info: { exception_type: 'AgentTimeoutError', exception_message: 'budget' }, agent_execution: { started_at: '2026-10-06T00:00:00Z' } }],
    ];
    for (const [id, fields] of samples) {
      mkdirSync(join(root, 'job', id), { recursive: true });
      writeFileSync(join(root, 'job', id, 'result.json'), JSON.stringify({ trial_name: id, task_name: 'task', ...fields }));
    }
    mkdirSync(join(root, 'job', 'request-error', 'agent'), { recursive: true });
    writeFileSync(join(root, 'job', 'request-error', 'result.json'), JSON.stringify({ trial_name: 'request-error', verifier_result: { rewards: { reward: 0 } } }));
    writeFileSync(join(root, 'job', 'request-error', 'agent', 'pi.txt'), JSON.stringify({ type: 'message_end', message: { stopReason: 'error', errorMessage: 'Connection error.' } }));
    const trials = taskResults(root), stats = summarize(trials, 6);
    assert.equal(trials.find(t => t.id === 'self-reported').status, 'ungraded');
    assert.equal(stats.successRate, 1 / 2); assert.equal(stats.setupErrors, 1); assert.equal(stats.errors, 2);
    assert.equal(trials.find(t => t.id === 'request-error').status, 'error');
    assert.equal(stats.inputTokens, 300); assert.equal(stats.outputTokens, 50);
    assert.equal(summarize([], 3).successRate, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy console JSON is parsed without mistaking log lines for results', () => {
  const result = { model: 'muse', results: [{ phase: 'generation', tokens: 7 }] };
  assert.deepEqual(parseSpeedOutput(`Prefill log\nreport /tmp/report.html\n\n${JSON.stringify(result, null, 2)}\n`), result);
  assert.equal(parseSpeedOutput('not a completed result'), null);
});

test('model discovery uses loaded LM Studio models and supports generic endpoints', async () => {
  let studio = true;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v0/models' && studio) res.end(JSON.stringify({ data: [{ id: 'loaded', state: 'loaded', type: 'llm' }, { id: 'cold', state: 'not-loaded', type: 'llm' }, { id: 'embed', state: 'loaded', type: 'embeddings' }] }));
    else if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'muse' }] }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual((await discoverModels(endpoint)).models, [{ id: 'loaded', loaded: true }]);
    studio = false;
    assert.equal((await discoverModels(endpoint)).models[0].id, 'muse');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('typed actions validate input before calling the runner', async () => {
  const actions = createActions({ start: () => assert.fail('invalid input reached runner') });
  await assert.rejects(() => actions.startRun.run({ kind: 'tasks', model: 'muse', repeats: -1 }));
});

test('runs persist, queued cancellation prevents execution, and restart marks interrupted work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-runner-'));
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); if (req.url !== '/v1/models') { res.statusCode = 404; res.end('{}'); } else res.end(JSON.stringify({ data: [{ id: 'muse' }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const children = [];
  const spawnProcess = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); children.push(child); return child;
  };
  const manager = new RunManager({ root: ROOT, runs: directory, spawnProcess });
  const config = { kind: 'speed', model: 'muse', endpoint: `http://127.0.0.1:${server.address().port}` };
  try {
    const first = await manager.start(config), second = await manager.start(config);
    assert.equal(first.status, 'running'); assert.equal(second.status, 'queued'); assert.equal(children.length, 1);
    manager.cancel(second.id); children[0].stdout.emit('data', '\n' + JSON.stringify({ results: [] }, null, 2)); children[0].emit('close', 0);
    assert.equal(manager.get(first.id).status, 'completed'); assert.equal(manager.get(second.id).status, 'cancelled'); assert.equal(children.length, 1);
    const empty = await manager.start(config); children[1].emit('close', 0);
    assert.equal(manager.get(empty.id).status, 'error');
    const id = randomUUID(); mkdirSync(join(directory, id)); writeFileSync(join(directory, id, 'run.json'), JSON.stringify({ id, status: 'running', createdAt: new Date().toISOString() }));
    const restored = new RunManager({ root: ROOT, runs: directory, spawnProcess });
    assert.equal(restored.get(id).status, 'interrupted');
    assert.throws(() => manager.file(first.id, '../outside'));
    symlinkSync(join(ROOT, 'README.md'), join(directory, first.id, 'escape'));
    assert.throws(() => manager.file(first.id, 'escape'), /outside/);
  } finally { rmSync(directory, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve)); }
});

test('localhost API rejects cross-origin requests, unknown actions and missing headers', async () => {
  const manager = { list: () => [], close() {} };
  const app = await startServer({ port: 0, manager, production: true });
  const endpoint = `http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(endpoint + '/api/listRuns', { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(endpoint + '/api/listRuns', { method: 'POST', headers: { 'X-Benchmark-Studio': '1', Origin: 'https://example.com' }, body: '{}' })).status, 403);
    assert.equal((await fetch(endpoint + '/api/nope', { method: 'POST', headers: { 'X-Benchmark-Studio': '1' }, body: '{}' })).status, 404);
    const response = await fetch(endpoint + '/api/listRuns', { method: 'POST', headers: { 'X-Benchmark-Studio': '1' }, body: '{}' });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
  } finally { await app.stop(); }
});
