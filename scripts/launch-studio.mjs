import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const assets = ['bench.mjs', 'package.json', 'studio', 'tasks', 'harness', 'scripts/setup-studio.mjs', 'scripts/setup-runtime.mjs'];
const excluded = new Set(['node_modules', 'dist', '__pycache__']);
const include = path => !path.split(/[\\/]/).some(part => excluded.has(part)) && !/^studio[\\/]tests(?:[\\/]|$)/.test(path);

export function parseStudioArgs(args) {
  const options = { setup: false, port: Number(process.env.BENCHMARK_PORT || 4310), data: resolve(process.env.BENCHMARK_DATA_DIR || join(process.cwd(), 'out', 'studio')) };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--setup') options.setup = true;
    else if (arg === '--port' || arg === '--data-dir') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--port') options.port = Number(value);
      else options.data = resolve(value);
    } else throw new Error(`Unknown Studio option: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer between 1 and 65535');
  return options;
}

// Hash shipped sources so development edits and different package releases never
// reuse a stale UI. Generated files and installed dependencies are excluded.
export function studioCacheKey(root = source) {
  const hash = createHash('sha256');
  function visit(relative) {
    const path = join(root, relative);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) if (include(`${relative}/${name}`)) visit(`${relative}/${name}`);
    } else { hash.update(relative); hash.update('\0'); hash.update(readFileSync(path)); }
  }
  for (const asset of assets) visit(asset);
  return hash.digest('hex').slice(0, 20);
}

function run(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} failed (exit ${result.status}). Run the Studio command again to retry.`);
}

export function prepareStudio({ root = source, cache = resolve(process.env.BENCHMARK_CACHE_DIR || join(homedir(), '.cache', 'the-benchmark')), execute = run } = {}) {
  const runtime = join(cache, studioCacheKey(root));
  if (existsSync(join(runtime, '.ready'))) return runtime;
  mkdirSync(cache, { recursive: true });
  const lock = runtime + '.lock';
  try { mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another Studio setup is in progress. Retry when it finishes. If it was interrupted, remove ${lock}.`);
    throw error;
  }
  try {
    mkdirSync(runtime, { recursive: true });
    for (const asset of assets) cpSync(join(root, asset), join(runtime, asset), {
      recursive: true, filter: path => include(relative(root, path)),
    });
    console.log('Installing the optional Studio UI (first launch; requires internet access)…');
    execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', 'studio'], runtime);
    execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'studio', 'run', 'build'], runtime);
    writeFileSync(join(runtime, '.ready'), 'ready\n');
    return runtime;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

export async function launchStudio(args) {
  const options = parseStudioArgs(args);
  if (options.help) {
    console.log('Usage: the-benchmark studio [--port 4310] [--data-dir PATH] [--setup]\n\nStarts the local UI. First launch installs and builds its optional dependencies.\nVerified tasks automatically prepare Python, Harbor and Pi when Docker is running.\n--setup prepares the task runner before opening the UI.\nRequires Node 22.22+ and npm. Automatic task setup supports macOS and Linux.\nRuns default to ./out/studio; BENCHMARK_CACHE_DIR overrides the UI install cache.');
    return;
  }
  const check = spawnSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8' });
  const [major, minor] = (check.stdout || '').trim().split('.').map(Number);
  if (check.error || check.status !== 0 || !(major > 22 || major === 22 && minor >= 22)) throw new Error('Studio requires Node 22.22+ (Node 24 recommended) installed on PATH.');
  const runtime = prepareStudio();
  if (options.setup) {
    const { setupTaskRuntime } = await import('./setup-runtime.mjs');
    await setupTaskRuntime(runtime, text => process.stdout.write(text));
  }
  const child = spawn('node', [join(runtime, 'studio/server.mjs'), '--production'], {
    cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, BENCHMARK_PORT: String(options.port), BENCHMARK_DATA_DIR: options.data },
  });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); resolve(); });
    });
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}
