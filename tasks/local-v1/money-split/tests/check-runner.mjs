import { inspect } from 'node:util';

// Each check runs even after an earlier assertion fails. The parent verifier
// owns the report file and final all-checks-required reward.
export function createChecks() {
  const checks = [];
  return {
    check(id, label, run) {
      try { run(); checks.push({ id, label, status: 'passed' }); }
      catch (error) {
        const entry = { id, label, status: 'failed', message: String(error.message || error).slice(0, 2000) };
        if ('expected' in Object(error)) entry.expected = inspect(error.expected, { depth: 4, maxArrayLength: 20 }).slice(0, 2000);
        if ('actual' in Object(error)) entry.actual = inspect(error.actual, { depth: 4, maxArrayLength: 20 }).slice(0, 2000);
        checks.push(entry);
      }
    },
    finish() {
      const report = { schemaVersion: 1, complete: true, checks };
      console.log('BENCHMARK_CHECKS ' + JSON.stringify(report));
      const failed = checks.filter(c => c.status === 'failed').length;
      console.log(`${checks.length - failed}/${checks.length} functional checks passed`);
      process.exitCode = failed ? 1 : 0;
    },
  };
}
