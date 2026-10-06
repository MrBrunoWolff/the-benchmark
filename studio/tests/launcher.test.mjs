import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseStudioArgs, prepareStudio, studioCacheKey } from '../../scripts/launch-studio.mjs';
import { installUv, setupTaskRuntime } from '../../scripts/setup-runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('Studio arguments select persistent data and reject invalid ports/options before installation', () => {
  const options = parseStudioArgs(['--port', '4321', '--data-dir', '/tmp/results', '--setup']);
  assert.equal(options.port, 4321); assert.equal(options.data, '/tmp/results'); assert.equal(options.setup, true);
  for (const args of [['--port', '0'], ['--port', '65536'], ['--port', '1.5'], ['--port'], ['--data-dir'], ['--unknown']]) assert.throws(() => parseStudioArgs(args));
});

test('optional install works under node_modules, includes graders, and caches only successful builds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-launcher-'));
  try {
    const source = join(directory, 'node_modules', 'the-benchmark');
    const cache = join(directory, 'cache');
    const copied = ['bench.mjs', 'package.json', 'studio', 'harness', 'tasks', 'scripts'];
    for (const asset of copied) cpSync(join(root, asset), join(source, asset), { recursive: true,
      filter: path => !path.split('/').includes('node_modules') && !path.split('/').includes('dist'),
    });
    let calls = 0;
    const execute = () => { calls++; if (calls === 2) throw new Error('build interrupted'); };
    assert.throws(() => prepareStudio({ root: source, cache, execute }), /build interrupted/);
    assert.equal(existsSync(join(cache, studioCacheKey(source), '.ready')), false);
    const runtime = prepareStudio({ root: source, cache, execute });
    assert.equal(calls, 4);
    assert.ok(existsSync(join(runtime, 'studio/package-lock.json')));
    assert.ok(existsSync(join(runtime, 'tasks/local-v1/money-split/tests/verify.mjs')));
    assert.equal(existsSync(join(runtime, 'studio/tests')), false);
    assert.equal(prepareStudio({ root: source, cache, execute }), runtime);
    assert.equal(calls, 4);
    writeFileSync(join(source, 'studio/src/main.jsx'), '// different release');
    assert.notEqual(studioCacheKey(source), runtime.split('/').at(-1));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('uv downloads must pass the release checksum before extraction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-uv-'));
  try {
    const bytes = Buffer.from('release archive');
    let extracted = false;
    const download = async url => new Response(url.endsWith('.sha256') ? createHash('sha256').update(bytes).digest('hex') : bytes);
    await installUv(directory, () => {}, { download, execute: async () => { extracted = true; } });
    assert.equal(extracted, true);
    extracted = false;
    await assert.rejects(() => installUv(directory, () => {}, { download: async url => new Response(url.endsWith('.sha256') ? '0'.repeat(64) : bytes), execute: async () => { extracted = true; } }), /checksum/);
    assert.equal(extracted, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('task setup requires Docker first, retries partial installs and marks complete only after image build', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-setup-'));
  try {
    let uvCalls = 0, fail = true;
    const commands = [];
    const getUv = async () => { uvCalls++; return '/local/uv'; };
    const execute = async (command, args) => {
      commands.push([command, args]);
      if (args[0] === 'venv') { mkdirSync(join(directory, '.venv/bin'), { recursive: true }); writeFileSync(join(directory, '.venv/bin/python'), ''); }
      if (args[0] === 'pip' && fail) { fail = false; throw new Error('download interrupted'); }
      if (args[0] === 'pip') writeFileSync(join(directory, '.venv/bin/harbor'), '');
    };
    await assert.rejects(() => setupTaskRuntime(directory, () => {}, { execute, getUv }), /download interrupted/);
    assert.equal(existsSync(join(directory, '.task-runtime-ready')), false);
    await setupTaskRuntime(directory, () => {}, { execute, getUv });
    assert.equal(commands.filter(([, args]) => args[0] === 'venv').length, 1);
    assert.equal(commands[0][0], 'docker');
    assert.ok(existsSync(join(directory, '.task-runtime-ready')));
    await setupTaskRuntime(directory, () => {}, { execute, getUv });
    assert.equal(uvCalls, 2);
    assert.equal(commands.at(-1)[1][0], 'build');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
