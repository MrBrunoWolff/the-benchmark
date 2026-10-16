export function parseCheckReport(report, source = 'verifier') {
  if (report?.schemaVersion !== 1 || report.complete !== true || !Array.isArray(report.checks) ||
    !report.checks.length || report.checks.length > 500) return null;
  const ids = new Set();
  const checks = [];
  for (const item of report.checks) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id) ||
      typeof item.label !== 'string' || !item.label || item.label.length > 500 ||
      !['passed', 'failed'].includes(item.status)) return null;
    ids.add(item.id);
    const check = { id: item.id, label: item.label, status: item.status };
    for (const key of ['message', 'expected', 'actual']) {
      if (typeof item[key] === 'string') check[key] = item[key].slice(0, 2000);
    }
    checks.push(check);
  }
  return { schemaVersion: 1, complete: true, source, checks,
    evaluatedAt: typeof report.evaluatedAt === 'string' ? report.evaluatedAt.slice(0, 40) : null,
    verifierHash: typeof report.verifierHash === 'string' && /^[a-f0-9]{64}$/.test(report.verifierHash) ? report.verifierHash : null };
}

export function summarizeChecks(trials, expectedAttempts = trials.length) {
  const reports = trials.map(t => t.checks).filter(r => r?.complete && Array.isArray(r.checks));
  if (!reports.length) return null;
  const all = reports.flatMap(r => r.checks);
  const passed = all.filter(c => c.status === 'passed').length;
  return { passed, failed: all.length - passed, total: all.length, rate: passed / all.length,
    reportedAttempts: reports.length, expectedAttempts,
    replayedAttempts: reports.filter(r => r.source === 'artifact-replay').length };
}
