import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const UV_VERSION = '0.12.23';

export function runtimeCommand(command, args, root, log = () => {}, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env,
      UV_CACHE_DIR: join(root, '.uv-cache'), UV_PYTHON_INSTALL_DIR: join(root, '.python'),
    }, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => log(String(data)));
    child.stderr.on('data', data => log(String(data)));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}). Check the setup log and retry.`)));
  });
}

export async function installUv(root, log, { download = fetch, execute = runtimeCommand, signal } = {}) {
  const uv = join(root, '.tools', 'uv');
  if (existsSync(uv)) return uv;
  const machine = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const system = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu' }[process.platform];
  if (!machine || !system) throw new Error('Automatic task setup supports macOS and Linux on x64/ARM64.');
  const archive = `uv-${machine}-${system}.tar.gz`;
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archive}`;
  log(`Downloading uv ${UV_VERSION} to the local Studio runtime…\n`);
  const get = async url => {
    const response = await download(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
    return response;
  };
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  const checksum = (await (await get(url + '.sha256')).text()).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(checksum) || createHash('sha256').update(bytes).digest('hex') !== checksum.toLowerCase()) throw new Error('uv archive checksum verification failed');
  mkdirSync(join(root, '.tools'), { recursive: true });
  const path = join(root, '.tools', archive);
  writeFileSync(path, bytes);
  await execute('tar', ['-xzf', path, '-C', join(root, '.tools'), '--strip-components=1'], root, log, signal);
  return uv;
}

export async function setupTaskRuntime(root, log = () => {}, { execute = runtimeCommand, getUv = installUv, signal } = {}) {
  await execute('docker', ['info', '--format', '{{.ServerVersion}}'], root, log, signal);
  if (!existsSync(join(root, '.task-runtime-ready')) || !existsSync(join(root, '.venv/bin/harbor'))) {
    const uv = await getUv(root, log, { signal });
    log('Preparing Python 3.12 and the verified-task runner…\n');
    if (!existsSync(join(root, '.venv/bin/python'))) await execute(uv, ['venv', '--python', '3.12', '.venv'], root, log, signal);
    await execute(uv, ['pip', 'install', '--python', '.venv/bin/python', '-r', 'harness/requirements.lock'], root, log, signal);
  }
  log('Preparing the Pi agent image…\n');
  await execute('docker', ['build', '-t', 'the-benchmark-pi:1.0.4', 'harness'], root, log, signal);
  writeFileSync(join(root, '.task-runtime-ready'), 'ready\n');
  log('Task runner ready. Starting your benchmark…\n');
}
