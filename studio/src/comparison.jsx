import React from 'react';
import { comparisonDifferences, taskComparison } from '../lib/comparison.mjs';
import { summarizeChecks } from '../lib/checks.mjs';

const colors = ['#dc5a32', '#527ea4', '#63836d', '#9670a6', '#b18a32', '#368d91'];
const seconds = n => n == null ? 'No passing attempts' : `${n.toFixed(1)}s`;

export function Comparison({ runs, suite, inspect }) {
  if (runs.length < 2) return <section className="panel compare-empty"><h2>Select runs from two different models</h2><p>Choose one saved verified-task run per model below. Selecting another run of the same model replaces its previous selection.</p></section>;
  const differences = comparisonDifferences(runs);
  const tasks = [...new Set(runs.flatMap(r => r.config.tasks))];
  const title = task => suite?.tasks.find(t => t.id === task)?.title || task;
  const maxTime = Math.max(1, ...tasks.flatMap(task => runs.map(r => taskComparison(r, task)?.median || 0)));
  return <>
    <section className="panel comparison-context"><h2>{runs.length} models · {tasks.length} tasks</h2><p>{differences.length ? `Different settings: ${differences.join(', ')}. These differences can affect the results.` : 'Task versions, harness, budgets and recorded environment match.'}</p><p>Model quantization and unrecorded server settings can still differ. Pass rates include every planned attempt; errors and missing results remain visible.</p><div className="chart-legend">{runs.map((run, i) => <button key={run.id} onClick={() => inspect(run.id)}><span style={{ background: colors[i % colors.length] }}/>{run.config.model}<small>{run.id.slice(0, 8)}</small></button>)}</div></section>
    <div className="comparison-charts">{['success', 'checks', 'time'].map(kind => <section className="panel" key={kind}><div className="panel-heading"><h2>{kind === 'success' ? 'Verified passes by task' : kind === 'checks' ? 'Functional checks by task' : 'Time to a passing result'}</h2></div><p className="chart-description">{kind === 'success' ? 'Higher is better · passes / planned attempts' : kind === 'checks' ? 'Recorded checks only · missing details are not zero scores' : 'Lower is better · median of passing attempts only'}</p>{tasks.map(task => <div className="chart-task" key={task}><h3>{title(task)}</h3>{runs.map((run, i) => {
      const metric = taskComparison(run, task);
      const checks = summarizeChecks((run.trials || []).filter(t => t.task === task), run.config.repeats);
      const label = !metric ? 'Not selected' : kind === 'checks' ? checks ? `${checks.passed}/${checks.total} checks` : 'Details unavailable' : kind === 'success' ? `${metric.passed}/${metric.expected} passed` : seconds(metric.median);
      const width = !metric ? 0 : kind === 'checks' ? (checks?.rate || 0) * 100 : kind === 'success' ? metric.rate * 100 : (metric.median || 0) / maxTime * 100;
      return <button className="chart-row" key={run.id} onClick={() => inspect(run.id)} aria-label={`${title(task)}, ${run.config.model}: ${label}`}><span className="chart-model" title={run.config.model}>{run.config.model}</span><span className="chart-track"><span style={{ width: `${width}%`, background: colors[i % colors.length] }}/></span><span className="chart-value">{label}{kind === 'checks' && checks && <small>{checks.reportedAttempts}/{checks.expectedAttempts} attempts{checks.replayedAttempts ? ' · replay' : ''}</small>}</span></button>;
    })}</div>)}</section>)}</div>
    <section className="panel result-panel"><div className="panel-heading"><h2>Task outcomes</h2><span className="small-label">SELECT A RESULT TO INSPECT</span></div><div className="table-scroll"><table><thead><tr><th>Task</th>{runs.map(run => <th key={run.id}>{run.config.model}</th>)}</tr></thead><tbody>{tasks.map(task => <tr key={task}><td><strong>{title(task)}</strong></td>{runs.map(run => {
      const m = taskComparison(run, task);
      const checks = summarizeChecks((run.trials || []).filter(t => t.task === task), run.config.repeats);
      return <td key={run.id}>{m ? <button className="outcome-link" onClick={() => inspect(run.id)}><strong>{m.passed}/{m.expected} passed</strong><small>{m.failed} failed · {m.errors} errors · {m.missing + m.ungraded} ungraded</small><small>{checks ? `${checks.passed}/${checks.total} checks · ${checks.reportedAttempts}/${checks.expectedAttempts} attempts with details${checks.replayedAttempts ? ' · artifact replay' : ''}` : 'Check details unavailable'}</small><small>{seconds(m.median)}</small></button> : 'Not selected'}</td>;
    })}</tr>)}</tbody></table></div></section>
  </>;
}
