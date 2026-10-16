import React from 'react';
import { summarizeChecks } from '../lib/checks.mjs';

export function FunctionalChecks({ run, suite }) {
  const summary = summarizeChecks(run.trials || [], run.summary?.expected || 0);
  return <section className="panel functional-checks"><div className="panel-heading"><h2>Functional checks</h2><span className="small-label">TASK PASS STILL REQUIRES EVERY CHECK</span></div>
    <p className="check-description">{summary ? `${summary.passed}/${summary.total} recorded checks passed · details for ${summary.reportedAttempts}/${summary.expectedAttempts} planned attempts.` : 'Check details were not recorded for this run. Its original task scores are preserved.'}</p>
    {summary?.replayedAttempts > 0 && <p className="check-description">Artifact replay uses the current verifier on saved files. It adds diagnostics; it does not change the original task score.</p>}
    {(run.trials || []).map(trial => <details className="check-attempt" key={trial.id}><summary><span>{suite?.tasks.find(t => t.id === trial.task)?.title || trial.task}<small>{trial.id}{trial.checks?.source === 'artifact-replay' ? ' · artifact replay' : ''}</small></span><strong>{trial.checks ? `${trial.checks.checks.filter(c => c.status === 'passed').length}/${trial.checks.checks.length} checks` : 'Details unavailable'}</strong></summary>
      {trial.checks ? <ul className="check-list">{trial.checks.checks.map(check => <li key={check.id} className={check.status}><span className="check-status">{check.status === 'passed' ? 'PASS' : 'FAIL'}</span><div><strong>{check.label}</strong>{check.status === 'failed' && <>{check.expected != null && <pre>Expected: {check.expected}{'\n'}Actual: {check.actual ?? 'Unavailable'}</pre>}{check.expected == null && check.message && <pre>{check.message}</pre>}</>}</div></li>)}</ul> : <p className="check-description">No complete per-check report is available. Inspect the original verifier logs in Artifacts &amp; logs.</p>}
    </details>)}
  </section>;
}
