import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, ['/tests/checks.mjs'], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
console.log(result.stdout || ''); console.error(result.stderr || '');
let report;
for (const line of (result.stdout || '').split('\n')) {
  if (!line.startsWith('BENCHMARK_CHECKS ')) continue;
  try { report = JSON.parse(line.slice('BENCHMARK_CHECKS '.length)); } catch { /* Incomplete output is not a report. */ }
}
const complete = !result.error && report?.schemaVersion === 1 && report.complete === true &&
  Array.isArray(report.checks) && report.checks.length > 0 &&
  report.checks.every(c => ['passed', 'failed'].includes(c.status));
if (complete) {
  const hash = createHash('sha256');
  for (const file of ['checks.mjs', 'check-runner.mjs', 'verify.mjs']) hash.update(file).update(readFileSync(fileURLToPath(new URL(file, import.meta.url))));
  report.verifierHash = hash.digest('hex');
  report.evaluatedAt = new Date().toISOString();
  writeFileSync('/logs/verifier/check-results.json', JSON.stringify(report, null, 2));
}
const passed = complete && result.status === 0 && report.checks.every(c => c.status === 'passed');
writeFileSync('/logs/verifier/reward.txt', passed ? '1' : '0');
console.log(passed ? 'VERIFIED PASS' : 'VERIFIED FAIL');
