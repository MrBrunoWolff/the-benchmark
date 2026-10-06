#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const steps = [
  ['npm', ['ci', '--ignore-scripts', '--prefix', 'studio']],
  ...(!existsSync(root + '.venv/bin/python') ? [['uv', ['venv', '--python', '3.12', '.venv']]] : []),
  ['uv', ['pip', 'install', '--python', '.venv/bin/python', '-r', 'harness/requirements.lock']],
  ['docker', ['build', '-t', 'the-benchmark-pi:1.0.4', 'harness']],
];
for (const [command, args] of steps) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error(r.error?.message || `${command} failed; start Docker Desktop if needed.`);
    process.exit(1);
  }
}
console.log('\nReady. Run npm run studio, then open http://localhost:4310.');
