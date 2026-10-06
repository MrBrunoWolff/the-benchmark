import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { arch, platform, cpus, totalmem } from 'node:os';
import { ROOT, RUNS, VERSIONS, parseConfig, localEndpoint, harborConfig, safeRelative } from './config.mjs';
import { walkFiles, readJson, taskResults, summarize, parseSpeedOutput } from './results.mjs';

const exec = promisify(execFile);
const stripAnsi = text => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
async function backendSnapshot(endpoint, model) {
  const read = async path => {
    try {
      const response = await fetch(endpoint + path, { redirect: 'error', signal: AbortSignal.timeout(2000) });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const [version, loaded, studio] = await Promise.all([read('/api/version'), read('/api/ps'), read('/api/v0/models')]);
  return { serverVersion: version?.version || null,
    model: loaded?.models?.find(m => m.name === model || m.model === model) || studio?.data?.find(m => m.id === model) || null,
    capturedAt: new Date().toISOString() };
}
export async function discoverModels(endpoint) {
  const origin = localEndpoint(endpoint);
  const request = async path => {
    const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Local server returned HTTP ${response.status}`);
    return response.json();
  };
  let models;
  try {
    const native = await request('/api/v0/models');
    if (!Array.isArray(native.data)) throw new Error('Not LM Studio');
    models = native.data.filter(m => m.type === 'llm' && m.state === 'loaded').map(m => ({ id: m.id, loaded: true }));
  } catch {
    const data = await request('/v1/models');
    models = (data.data || []).map(m => ({ id: m.id, loaded: null }));
  }
  return { endpoint: origin, models: models.filter(m => typeof m.id === 'string'), available: true };
}

export class RunManager {
  constructor({ root = ROOT, runs = RUNS, spawnProcess = spawn } = {}) {
    this.root = root; this.directory = runs; this.spawnProcess = spawnProcess;
    this.runs = new Map(); this.active = null; this.queue = [];
    mkdirSync(runs, { recursive: true });
    for (const id of readdirSync(runs)) {
      const run = readJson(join(runs, id, 'run.json'));
      if (!run || !/^[a-f0-9-]{36}$/.test(id)) continue;
      if (['running', 'queued', 'cancelling'].includes(run.status)) {
        run.status = 'interrupted'; run.finishedAt = new Date().toISOString();
        run.error = 'Studio stopped before this run completed. Start a new attempt.';
      }
      this.runs.set(id, run);
      if (run.config?.kind === 'tasks') this.refresh(run);
      this.save(run);
    }
  }
  save(run) {
    const path = join(this.directory, run.id, 'run.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path + '.tmp', JSON.stringify(run, null, 2)); renameSync(path + '.tmp', path);
  }
  list() { return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { const run = this.runs.get(id); if (!run) throw new Error('Run not found'); return run; }
  async health() {
    const check = async (command, args) => {
      try { const { stdout } = await exec(command, args, { timeout: 6000, maxBuffer: 1024 * 1024 }); return { ready: true, detail: stdout.trim() }; }
      catch (error) { return { ready: false, detail: error.code === 'ENOENT' ? 'Not installed' : stripAnsi(error.stderr || error.message).slice(0, 350) }; }
    };
    const [docker, harbor, image] = await Promise.all([
      check('docker', ['info', '--format', '{{.ServerVersion}}']),
      check(join(this.root, '.venv/bin/harbor'), ['--version']),
      check('docker', ['image', 'inspect', 'the-benchmark-pi:1.0.4', '--format', '{{.Id}}']),
    ]);
    return { docker, harbor, image, versions: VERSIONS, taskReady: docker.ready && harbor.ready && image.ready };
  }
  async start(input) {
    const config = parseConfig(input);
    if (config.model.endsWith(':cloud')) throw new Error('Select a downloaded local model; cloud models are excluded');
    const discovery = await discoverModels(config.endpoint);
    if (!discovery.models.some(m => m.id === config.model)) throw new Error('Selected model is not available at this endpoint; refresh models');
    if (config.kind === 'tasks') {
      const health = await this.health();
      if (!health.taskReady) throw new Error('Task runner is not ready. Run npm run studio:setup and start Docker Desktop.');
    }
    const backend = await backendSnapshot(config.endpoint, config.model);
    const id = randomUUID(), createdAt = new Date().toISOString();
    const taskHashes = Object.fromEntries(config.tasks.map(task => {
      const path = join(this.root, 'tasks/local-v1', task);
      const hash = createHash('sha256');
      for (const file of walkFiles(path).sort()) hash.update(relative(path, file)).update(readFileSync(file));
      return [task, hash.digest('hex')];
    }));
    const hardware = { platform: platform(), architecture: arch(), cpu: cpus()[0]?.model,
      cpuCount: cpus().length, memoryBytes: totalmem() };
    const run = { id, status: 'queued', createdAt, config, backend, hardware, versions: VERSIONS, suite: 'local-v1@1.0.0', taskHashes,
      trials: [], summary: config.kind === 'tasks' ? summarize([], config.tasks.length * config.repeats) : null };
    this.runs.set(id, run); this.save(run); this.queue.push(id); this.pump();
    return run;
  }
  pump() {
    if (this.active || !this.queue.length) return;
    const id = this.queue.shift(), run = this.get(id), directory = join(this.directory, id);
    run.status = 'running'; run.startedAt = new Date().toISOString(); this.save(run);
    let command, args;
    if (run.config.kind === 'tasks') {
      const config = harborConfig(run.config, id, this.root);
      config.jobs_dir = directory;
      writeFileSync(join(directory, 'harbor.json'), JSON.stringify(config, null, 2));
      command = join(this.root, '.venv/bin/harbor'); args = ['run', '--config', join(directory, 'harbor.json')];
    } else {
      const c = run.config;
      command = process.execPath; args = [join(this.root, 'bench.mjs'), '--url', c.endpoint, '--model', c.model,
        '--phases', c.phases.join(','), '--runs', String(c.repeats), '--sizes', c.sizes.join(','),
        '--depth', c.depths.join(','), '--concurrency', c.concurrency.join(','), '--gen-tokens', String(c.genTokens),
        '--turn-tokens', String(c.maxTokens), '--max-turns', String(c.maxTurns), '--turn-timeout', String(c.timeout),
        '--out', join(directory, 'reports'), '--json', '--no-live'];
      if (c.reasoning !== 'default') args.push('--reasoning', c.reasoning);
      if (c.phases.includes('system-one')) args.push('--system-one-providers', 'local');
    }
    // No user-controlled shell, and no provider credentials inherited by the child.
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'DOCKER_HOST', 'DOCKER_CONTEXT'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { PYTHONPATH: join(this.root, 'harness'), HARBOR_TELEMETRY: 'off',
      HF_HUB_OFFLINE: '1', LITELLM_LOCAL_MODEL_COST_MAP: 'True' });
    const child = this.spawnProcess(command, args, { cwd: this.root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    this.active = { id, child, output: '', stopped: false };
    const append = chunk => {
      const text = stripAnsi(String(chunk));
      if (this.active?.id !== id) return;
      this.active.output = (this.active.output + text).slice(-2 * 1024 * 1024);
      writeFileSync(join(directory, 'console.log'), this.active.output);
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const poll = setInterval(() => this.refresh(run), 1200);
    let finished = false;
    const finish = (code, error) => {
      if (finished) return; finished = true; clearInterval(poll);
      this.refresh(run);
      if (run.config.kind === 'speed') run.speed = parseSpeedOutput(this.active?.output || '');
      run.exitCode = code; run.finishedAt = new Date().toISOString();
      run.seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
      run.status = this.active?.stopped ? 'cancelled' : error || code !== 0 ? 'error' : 'completed';
      if (run.config.kind === 'speed' && run.status === 'completed' && !run.speed) {
        run.status = 'error'; run.error = 'CLI ended without a complete JSON result';
      }
      if (run.config.kind === 'tasks' && run.status === 'completed' && run.trials.length !== run.summary.expected) {
        run.status = 'error'; run.error = 'Runner ended without all expected trial results';
      }
      if (error) run.error = error.message;
      this.save(run); this.active = null; this.pump();
    };
    child.once('error', error => finish(null, error)); child.once('close', code => finish(code));
  }
  refresh(run) {
    if (run.config.kind !== 'tasks') return;
    run.trials = taskResults(join(this.directory, run.id));
    run.summary = summarize(run.trials, run.config.tasks.length * run.config.repeats); this.save(run);
  }
  cancel(id) {
    const run = this.get(id);
    if (run.status === 'queued') {
      this.queue = this.queue.filter(item => item !== id); run.status = 'cancelled'; run.finishedAt = new Date().toISOString(); this.save(run);
    } else if (this.active?.id === id && run.status === 'running') {
      run.status = 'cancelling'; this.active.stopped = true; this.save(run);
      // Harbor handles SIGINT by cancelling tasks and tearing down its containers.
      try { process.kill(-this.active.child.pid, 'SIGINT'); } catch { this.active.child.kill('SIGINT'); }
    }
    return run;
  }
  detail(id) {
    const run = this.get(id), directory = join(this.directory, id);
    let consoleText = ''; try { consoleText = readFileSync(join(directory, 'console.log'), 'utf8').slice(-80000); } catch {}
    const files = walkFiles(directory).filter(path => !path.endsWith('/run.json')).map(path => ({ path: relative(directory, path), size: statSync(path).size }));
    // Pi events are written by Harbor into the mounted agent log directory.
    const streams = files.filter(f => f.path.endsWith('/agent/pi.txt'));
    const events = streams.flatMap(f => {
      const text = this.file(id, f.path).text;
      return text.split('\n').flatMap(line => { try { const e = JSON.parse(line); return e.type === 'message_update' ? [] : [{ trial: f.path.split('/')[1], ...e }]; } catch { return []; } });
    }).slice(-160);
    return { ...run, console: consoleText, files, events };
  }
  file(id, path) {
    this.get(id);
    const root = realpathSync(join(this.directory, id)), file = safeRelative(root, path);
    const actual = realpathSync(file);
    if (!actual.startsWith(root + '/')) throw new Error('File is outside this run');
    const size = statSync(actual).size;
    if (size > 2 * 1024 * 1024) return { path, text: 'File exceeds the 2 MB inspector limit. Open it from the saved run directory.', truncated: true };
    return { path, text: readFileSync(actual, 'utf8'), truncated: false };
  }
  close() { for (const id of [...this.queue]) this.cancel(id); if (this.active) this.cancel(this.active.id); }
}
