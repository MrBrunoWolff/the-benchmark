const stable = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(stable(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))]))
  : value ?? null);

export function toggleComparison(ids, run, runs) {
  if (ids.includes(run.id)) return ids.filter(id => id !== run.id);
  if (run.config.kind !== 'tasks' || ['queued', 'running', 'cancelling'].includes(run.status)) return ids;
  // Choosing another attempt replaces the previous run for that model.
  return [...ids.filter(id => runs.find(r => r.id === id)?.config.model !== run.config.model), run.id];
}

export function comparisonDifferences(runs) {
  if (runs.length < 2) return [];
  const fields = {
    'Task selection': r => [...r.config.tasks].sort(),
    'Task versions': r => r.taskHashes,
    'Check verifier revisions': r => Object.fromEntries((r.trials || []).filter(t => t.checks?.verifierHash).map(t => [t.task, t.checks.verifierHash])),
    'Harness versions': r => r.versions,
    'Attempts per task': r => r.config.repeats,
    'Turn limit': r => r.config.maxTurns,
    'Output token limit': r => r.config.maxTokens,
    'Context window': r => r.config.contextWindow,
    'Time limit': r => r.config.timeout,
    Temperature: r => r.config.temperature,
    Reasoning: r => r.config.reasoning,
    Hardware: r => r.hardware,
    'Server version': r => r.backend?.serverVersion,
    Endpoint: r => r.config.endpoint,
  };
  return Object.entries(fields).filter(([, read]) => new Set(runs.map(r => stable(read(r)))).size > 1).map(([label]) => label);
}

export function taskComparison(run, task) {
  if (!run.config.tasks.includes(task)) return null;
  const trials = (run.trials || []).filter(t => t.task === task);
  const passed = trials.filter(t => t.status === 'passed');
  const times = passed.map(t => t.seconds).filter(t => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  return {
    expected: run.config.repeats, passed: passed.length,
    failed: trials.filter(t => t.status === 'failed').length,
    errors: trials.filter(t => ['error', 'setup_error'].includes(t.status)).length,
    ungraded: trials.filter(t => !['passed', 'failed', 'error', 'setup_error'].includes(t.status)).length,
    missing: Math.max(0, run.config.repeats - trials.length),
    rate: passed.length / run.config.repeats,
    median: times.length ? times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2 : null,
  };
}
