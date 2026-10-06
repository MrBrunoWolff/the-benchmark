#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupTaskRuntime } from './setup-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const result = spawnSync('npm', ['ci', '--ignore-scripts', '--prefix', 'studio'], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || 'Studio dependency installation failed');
  await setupTaskRuntime(root, text => process.stdout.write(text));
  console.log('\nReady. Run npm run studio, then open http://localhost:4310.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
