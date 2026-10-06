import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

async function action(name, input = {}) {
  const response = await fetch(`/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Benchmark-Studio': '1' }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const number = value => value == null ? '—' : Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
const percent = value => value == null ? '—' : `${Math.round(value * 100)}%`;
const duration = value => value == null ? '—' : value < 60 ? `${number(value)}s` : `${number(value / 60)}m`;
const busy = status => ['queued', 'running', 'cancelling'].includes(status);
const date = value => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    terminal: <><path d="m4 6 6 6-6 6m9 0h7"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}
function Badge({ status }) { return <span className={`badge ${status}`}><span/>{status.replaceAll('_', ' ')}</span>; }
function Metric({ label, value, note }) { return <div className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
function Field({ label, children, note }) { return <label className="field"><span>{label}</span>{children}{note && <small>{note}</small>}</label>; }

function App() {
  const [page, setPage] = useState('new');
  const [kind, setKind] = useState('tasks');
  const [endpoint, setEndpoint] = useState('http://localhost:11434');
  const [models, setModels] = useState([]), [model, setModel] = useState('');
  const [suite, setSuite] = useState(null), [tasks, setTasks] = useState(['money-split', 'csv-parser', 'ticket-triage']);
  const [health, setHealth] = useState(null), [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [connecting, setConnecting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [options, setOptions] = useState({ repeats: 1, maxTurns: 24, maxTokens: 4096, contextWindow: 32768, timeout: 600, reasoning: 'none', temperature: 0, genTokens: 256 });
  const [phases, setPhases] = useState(['prefill', 'generation']);
  const [sizes, setSizes] = useState('256,2048,8192'), [depths, setDepths] = useState('0'), [concurrency, setConcurrency] = useState('1,2,4');
  const [file, setFile] = useState(null), [tab, setTab] = useState('activity');
  const [compare, setCompare] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const activeRuns = runs.filter(run => busy(run.status));
  const opt = (key, value) => setOptions(prev => ({ ...prev, [key]: value }));
  const toggle = (list, item) => list.includes(item) ? list.filter(x => x !== item) : [...list, item];

  async function connect(value = endpoint) {
    setConnecting(true); setError('');
    try {
      const found = await action('discoverModels', { endpoint: value }); setModels(found.models);
      setModel(previous => found.models.some(m => m.id === previous) ? previous : found.models[0]?.id || '');
      if (!found.models.length) setError('No models available. Load a model in your local server, then refresh.');
    } catch (e) { setModels([]); setModel(''); setError(e.message); }
    finally { setConnecting(false); }
  }
  async function refresh() { setRuns(await action('listRuns')); }
  useEffect(() => {
    action('suite').then(setSuite).catch(e => setError(e.message));
    action('health').then(setHealth).catch(e => setError(e.message));
    connect(); refresh().catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    let alive = true, working = false;
    const update = async () => {
      if (working) return; working = true;
      try {
        const all = await action('listRuns'); if (alive) setRuns(all);
        if (selected) { const run = await action('getRun', { id: selected }); if (alive) { setDetail(run); setElapsed(run.startedAt ? (Date.now() - Date.parse(run.startedAt)) / 1000 : 0); } }
      } catch (e) { if (alive) setError(e.message); }
      finally { working = false; }
    };
    update(); const interval = setInterval(update, 1500);
    return () => { alive = false; clearInterval(interval); };
  }, [selected]);

  async function launch(config) {
    setPending(true); setError('');
    try {
      const run = await action('startRun', config); setSelected(run.id); setPage('run'); setDetail(run); setFile(null); setTab('activity'); await refresh();
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }
  async function start(event) {
    event.preventDefault();
    const csv = value => value.split(',').map(v => Number(v.trim()));
    await launch({ kind, endpoint, model, tasks, phases, ...options, sizes: csv(sizes), depths: csv(depths), concurrency: csv(concurrency) });
  }
  async function openRun(id) { setSelected(id); setDetail(null); setFile(null); setPage('run'); setTab('activity'); }
  async function openFile(path) { try { setFile(await action('getFile', { id: selected, path })); } catch (e) { setError(e.message); } }
  async function cancel() { try { await action('cancelRun', { id: selected }); await refresh(); } catch (e) { setError(e.message); } }
  function download() {
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `benchmark-${detail.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const goNew = () => { setPage('new'); setSelected(null); setFile(null); };
  const compared = runs.filter(run => compare.includes(run.id));
  const compareSignature = run => JSON.stringify({ tasks: run.taskHashes, versions: run.versions,
    turns: run.config.maxTurns, tokens: run.config.maxTokens, context: run.config.contextWindow,
    timeout: run.config.timeout, temperature: run.config.temperature, reasoning: run.config.reasoning });
  const matching = new Set(compared.map(compareSignature)).size <= 1;

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={goNew}><span className="brand-mark">b<span>.</span></span><span>the-benchmark<small>LOCAL EVALUATION LAB</small></span></button>
      <div className="workspace-tag"><span className="dot"/>Personal workspace<span className="mono">LOCAL</span></div>
      <nav aria-label="Main navigation">
        <button className={page === 'new' ? 'nav active' : 'nav'} onClick={goNew}><Icon name="grid"/>New benchmark<span>↗</span></button>
        <button className={page === 'history' ? 'nav active' : 'nav'} onClick={() => { setPage('history'); setSelected(null); }}><Icon name="clock"/>Run history<span>{runs.length}</span></button>
      </nav>
      <div className="sidebar-label">RECENT RUNS</div>
      <div className="recent-runs">{runs.slice(0, 7).map(run => <button className={`recent ${selected === run.id ? 'selected' : ''}`} key={run.id} onClick={() => openRun(run.id)}><span className={`run-dot ${run.status}`}/><span>{run.config.model}<small>{run.config.kind === 'tasks' ? 'Verified tasks' : 'Serving performance'} · {date(run.createdAt)}</small></span></button>)}{!runs.length && <p className="sidebar-empty">Your experiments will appear here.</p>}</div>
      <div className="sidebar-bottom"><span className="dot"/>Runs stay on this machine<small>Studio 0.4 · Agent-Native + Harbor</small></div>
    </aside>
    <main>
      <header className="topbar"><span>Workspace <span className="slash">/</span> {page === 'new' ? 'New benchmark' : page === 'history' ? 'Run history' : 'Run inspector'}</span><span className="top-local"><span className="dot"/>LOCAL INFERENCE</span></header>
      <div className="content">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close"/></button></div>}
        {page === 'new' && <>
          <div className="hero"><div className="eyebrow"><span/>FROM TOKENS TO TASKS</div><h1>Small models.<br/><span>Real work.</span></h1><p>Find out what your local models can actually do.<br/>Measure serving speed. Verify completed work.</p><div className="hero-index">01 <span>/ EVALUATE</span></div></div>
          <div className="mode-tabs" role="tablist" aria-label="Benchmark type"><button role="tab" aria-selected={kind === 'tasks'} className={kind === 'tasks' ? 'active' : ''} onClick={() => setKind('tasks')}><Icon name="terminal"/>Verified agent tasks<span>NEW</span></button><button role="tab" aria-selected={kind === 'speed'} className={kind === 'speed' ? 'active' : ''} onClick={() => setKind('speed')}><Icon name="clock"/>Serving performance</button></div>
          <form onSubmit={start}>
            <div className="setup-grid">
              <section className="panel connection-panel"><div className="panel-heading"><span className="step">01</span><h2>Choose your model</h2><span className="small-label">LOCAL SERVER</span></div>
                <div className="provider-buttons"><button type="button" className={endpoint === 'http://localhost:11434' ? 'chosen' : ''} onClick={() => { setEndpoint('http://localhost:11434'); connect('http://localhost:11434'); }}>Ollama</button><button type="button" className={endpoint === 'http://localhost:1234' ? 'chosen' : ''} onClick={() => { setEndpoint('http://localhost:1234'); connect('http://localhost:1234'); }}>LM Studio</button></div>
                <Field label="Endpoint"><div className="input-action"><input value={endpoint} onChange={e => { setEndpoint(e.target.value); setModels([]); setModel(''); }} placeholder="http://localhost:11434" required/><button type="button" onClick={() => connect()} disabled={connecting} aria-label="Refresh models"><Icon name="refresh"/></button></div></Field>
                <Field label="Model"><select value={model} onChange={e => setModel(e.target.value)} required><option value="">{connecting ? 'Connecting…' : 'Select a local model'}</option>{models.map(m => <option value={m.id} key={m.id}>{m.id}</option>)}</select></Field>
                <div className={`connection-status ${models.length ? 'ready' : ''}`}><span className="dot"/>{connecting ? 'Checking local endpoint…' : models.length ? `${models.length} model${models.length > 1 ? 's' : ''} available` : 'Waiting for a local model'}</div>
                {kind === 'tasks' && <div className="harness-note"><span className="small-label">AGENT HARNESS</span><strong>Pi <span className="mono">1.0.4</span></strong><p>A fixed harness and fresh sessions keep model comparisons consistent.</p></div>}
              </section>
              <section className="panel tasks-panel"><div className="panel-heading"><span className="step">02</span><h2>{kind === 'tasks' ? 'Choose the work' : 'Choose measurements'}</h2><span className="small-label">{kind === 'tasks' ? 'LOCAL FOUNDATIONS' : 'EXISTING BENCHMARKS'}</span></div>
                <p className="section-description">{kind === 'tasks' ? 'A small starter suite with independent functional checks.' : 'The original benchmark modes, now accessible from Studio.'}</p>
                {kind === 'tasks' ? suite?.tasks.map((task, i) => <label className={`task-card ${tasks.includes(task.id) ? 'checked' : ''}`} key={task.id}><input type="checkbox" checked={tasks.includes(task.id)} onChange={() => setTasks(toggle(tasks, task.id))}/><span className="task-number">0{i + 1}</span><span className="task-copy"><strong>{task.title}</strong><small>{task.description}</small></span><span className="category">{task.category}</span></label>) : [
                  ['prefill', 'Prompt processing', 'Measure how quickly the model reads different context sizes.'],
                  ['generation', 'Token generation', 'Measure decode speed, including deeper context.'],
                  ['concurrent', 'Concurrency sweep', 'Measure serving capacity with parallel requests.'],
                  ['agentic', 'Legacy agent smoke test', 'The original tip calculator tool loop; completion is self-reported.'],
                  ['system-one', 'Typed decisions', 'The existing support triage test, using the local provider only.'],
                ].map(([id, title, description], i) => <label className={`task-card ${phases.includes(id) ? 'checked' : ''}`} key={id}><input type="checkbox" checked={phases.includes(id)} onChange={() => setPhases(toggle(phases, id))}/><span className="task-number">0{i + 1}</span><span className="task-copy"><strong>{title}</strong><small>{description}</small></span></label>)}
                <div className="suite-footnote"><Icon name="check" size={14}/>{kind === 'tasks' ? 'Fresh Docker workspace · separate verifier · no LLM judge' : 'Same CLI and reports · no Docker required'}</div>
              </section>
            </div>
            <section className="panel settings-panel"><div className="panel-heading"><span className="step">03</span><h2>Set the budget</h2><button type="button" className="text-button" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Less' : 'Advanced'} {advanced ? '−' : '+'}</button></div>
              <div className="field-grid"><Field label={kind === 'tasks' ? 'Attempts per task' : 'Repeats'}><input type="number" min="1" max="10" value={options.repeats} onChange={e => opt('repeats', +e.target.value)}/></Field><Field label="Reasoning"><select value={options.reasoning} onChange={e => opt('reasoning', e.target.value)}>{['none', 'default', 'low', 'medium', 'high'].map(v => <option key={v} value={v}>{v === 'default' ? 'Server default' : v === 'none' ? 'Off' : v[0].toUpperCase() + v.slice(1)}</option>)}</select></Field><Field label={kind === 'tasks' ? 'Time limit / task' : 'Tool/decision request limit'}><div className="unit-input"><input type="number" min="30" max="3600" value={options.timeout} onChange={e => opt('timeout', +e.target.value)}/><span>seconds</span></div></Field>{(kind === 'tasks' || phases.includes('agentic')) && <Field label="Maximum turns"><input type="number" min="1" max="100" value={options.maxTurns} onChange={e => opt('maxTurns', +e.target.value)}/></Field>}</div>
              {advanced && <div className="field-grid advanced">{(kind === 'tasks' || phases.includes('agentic')) && <Field label="Output tokens / turn"><input type="number" min="256" max="16384" value={options.maxTokens} onChange={e => opt('maxTokens', +e.target.value)}/></Field>}{kind === 'tasks' && <><Field label="Context window" note="Match the context configured in your server."><input type="number" min="4096" max="262144" value={options.contextWindow} onChange={e => opt('contextWindow', +e.target.value)}/></Field><Field label="Temperature"><input type="number" min="0" max="2" step="0.1" value={options.temperature} onChange={e => opt('temperature', +e.target.value)}/></Field></>}{kind === 'speed' && <><Field label="Prompt sizes"><input value={sizes} onChange={e => setSizes(e.target.value)}/></Field><Field label="Context depths"><input value={depths} onChange={e => setDepths(e.target.value)}/></Field><Field label="Concurrency levels"><input value={concurrency} onChange={e => setConcurrency(e.target.value)}/></Field><Field label="Generation tokens"><input type="number" min="32" max="4096" value={options.genTokens} onChange={e => opt('genTokens', +e.target.value)}/></Field></>}</div>}
            </section>
            <div className="launch-row"><div><strong>{kind === 'tasks' ? `${tasks.length} tasks × ${options.repeats} attempt${options.repeats === 1 ? '' : 's'}` : `${phases.length} phases · ${options.repeats} repeats`}</strong><small>{activeRuns.length ? 'Queued after the current run. One local model at a time.' : 'Results and transcripts are saved locally.'}</small></div><button className="primary" disabled={pending || !model || connecting || (kind === 'tasks' ? !tasks.length || !health?.taskReady : !phases.length)}><Icon name="play" size={16}/>{pending ? 'Starting…' : activeRuns.length ? 'Queue benchmark' : 'Run benchmark'}<Icon name="arrow"/></button></div>
          </form>
          <div className="environment-strip"><span className="small-label">YOUR ENVIRONMENT</span>{kind === 'tasks' && ['docker', 'harbor', 'image'].map(key => <span className="env-check" key={key}><span className={`dot ${health?.[key]?.ready ? '' : 'muted'}`}/>{key === 'image' ? 'Pi image' : key === 'harbor' ? 'Harbor' : 'Docker'} {!health ? 'checking…' : health[key]?.ready ? 'ready' : 'unavailable'}</span>)}<button className="text-button" onClick={() => action('health').then(setHealth).catch(e => setError(e.message))}>Refresh</button></div>
          {kind === 'tasks' && health && !health.taskReady && <p className="setup-note">Start Docker Desktop and run <code>npm run studio:setup</code> to prepare the task runner.</p>}
        </>}

        {page === 'run' && detail && <>
          <div className="page-heading"><div><div className="eyebrow">{detail.config.kind === 'tasks' ? 'VERIFIED AGENT TASKS' : 'SERVING PERFORMANCE'}</div><h1 className="run-title">{detail.config.model}</h1><p>{date(detail.createdAt)} <span className="slash">/</span> {detail.config.kind === 'tasks' ? `Pi ${detail.versions.pi} · Local foundations` : detail.config.phases.join(' + ')}</p></div><Badge status={detail.status}/></div>
          <div className="metrics">{detail.config.kind === 'tasks' ? <><Metric label="Verified success" value={percent(detail.summary?.successRate)} note={`${detail.summary?.passed || 0} passed · ${(detail.summary?.passed || 0) + (detail.summary?.failed || 0)}/${detail.summary?.expected || 0} graded`}/><Metric label="Median task time" value={duration(detail.summary?.medianSeconds)} note="Agent execution, excluding setup"/><Metric label="Tokens used" value={number(detail.summary?.inputTokens == null && detail.summary?.outputTokens == null ? null : (detail.summary?.inputTokens || 0) + (detail.summary?.outputTokens || 0))} note={`${number(detail.summary?.outputTokens)} output tokens`}/><Metric label="Elapsed" value={duration(busy(detail.status) ? elapsed : detail.seconds)} note={`${detail.summary?.setupErrors || 0} setup errors · ${detail.summary?.errors || 0} execution errors`}/></> : <><Metric label="Run time" value={duration(busy(detail.status) ? elapsed : detail.seconds)}/><Metric label="Phases" value={detail.config.phases.length}/><Metric label="Repeats" value={detail.config.repeats}/><Metric label="Backend" value={new URL(detail.config.endpoint).port}/></>}</div>
          <div className="run-actions">{busy(detail.status) ? <button className="secondary" onClick={cancel} disabled={detail.status === 'cancelling'}>{detail.status === 'cancelling' ? 'Cleaning up…' : 'Cancel run'}</button> : <button className="primary compact" onClick={() => launch(detail.config)} disabled={pending}><Icon name="refresh"/>Run again</button>}<button className="secondary" onClick={download}>Export JSON</button><span className="mono run-id">{detail.id.slice(0, 8)}</span></div>
          {detail.error && <div className="error-banner" role="alert">{detail.error}</div>}
          {detail.config.kind === 'tasks' && <section className="panel result-panel"><div className="panel-heading"><h2>Task outcomes</h2><span className="small-label">INDEPENDENT VERIFICATION</span></div><div className="table-scroll"><table><thead><tr><th>Task / attempt</th><th>Outcome</th><th>Agent time</th><th>Input tokens</th><th>Output tokens</th></tr></thead><tbody>{detail.trials?.map(trial => <tr key={trial.id}><td><strong>{suite?.tasks.find(t => t.id === trial.task)?.title || trial.task}</strong><small>{trial.id}{trial.budgetExhausted ? ' · turn budget reached' : ''}</small>{trial.error && <small className="error-text">{trial.error.type}: {trial.error.message}</small>}</td><td><Badge status={trial.status}/></td><td>{duration(trial.seconds)}</td><td>{number(trial.inputTokens)}</td><td>{number(trial.outputTokens)}</td></tr>)}{!detail.trials?.length && <tr><td colSpan="5" className="empty-cell">{busy(detail.status) ? 'Preparing the environment. Task outcomes appear as attempts finish.' : 'No graded attempts.'}</td></tr>}</tbody></table></div></section>}
          {detail.speed && <section className="panel result-panel"><div className="panel-heading"><h2>Measurement results</h2></div><div className="table-scroll"><table><thead><tr><th>Phase</th><th>Configuration</th><th>Result</th></tr></thead><tbody>{detail.speed.results.map((row, i) => <tr key={i}><td>{row.phase}</td><td className="mono">{Object.entries(row).filter(([key, value]) => key !== 'phase' && !Array.isArray(value) && typeof value !== 'object').slice(0, 3).map(([key, value]) => `${key}: ${value}`).join(' · ')}</td><td><button className="text-button" onClick={() => setFile({ path: `${row.phase} / sample ${i + 1}`, text: JSON.stringify(row, null, 2) })}>Inspect sample →</button></td></tr>)}</tbody></table></div></section>}
          <section className="panel inspector"><div className="inspector-tabs"><button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Live activity</button><button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Artifacts & logs <span>{detail.files?.length || 0}</span></button><button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>Configuration</button>{busy(detail.status) && <span className="live-label"><span className="dot"/>LIVE</span>}</div>
            {tab === 'activity' && <><div className="terminal"><div className="terminal-bar"><span/><span/><span/><small>local runner</small></div><pre>{detail.console || (detail.status === 'queued' ? 'Waiting for the current benchmark to finish…' : 'Starting the local runner…')}</pre></div>{detail.events?.length > 0 && <div className="events"><h3>Agent transcript</h3>{detail.events.filter(e => ['tool_execution_start', 'tool_execution_end', 'message_end', 'benchmark_budget'].includes(e.type)).slice(-30).map((event, i) => <details key={i}><summary><span className="mono">{event.trial}</span> {event.toolName || event.message?.role || event.type}</summary><pre>{JSON.stringify(event.message?.content || event.result || event.args || event, null, 2)}</pre></details>)}</div>}</>}
            {tab === 'files' && <div className="file-list">{detail.files?.map(f => <button key={f.path} onClick={() => openFile(f.path)}><span className="mono">{f.path}</span><span>{number(f.size / 1024)} KB <Icon name="arrow" size={14}/></span></button>)}{!detail.files?.length && <p>No files saved yet.</p>}</div>}
            {tab === 'config' && <pre className="config-code">{JSON.stringify({ ...detail.config, versions: detail.versions, suite: detail.suite, taskHashes: detail.taskHashes, backend: detail.backend, hardware: detail.hardware }, null, 2)}</pre>}
          </section>
          <p className="results-note">{detail.config.kind === 'tasks' ? 'Success requires passing every functional check. Setup and execution errors are reported separately; success includes only independently graded attempts. This starter suite is too small for general capability claims.' : 'Legacy agent completion is self-reported. Use verified agent tasks to measure correctness.'}</p>
        </>}
        {page === 'run' && !detail && <p className="loading">Loading run…</p>}

        {page === 'history' && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR EXPERIMENTS</div><h1>Run history</h1><p>Saved locally. Ready to inspect and compare.</p></div><button className="primary compact" onClick={goNew}>New benchmark<Icon name="arrow"/></button></div>
          {compared.length > 0 && <section className="panel result-panel"><div className="panel-heading"><h2>Compare selected runs</h2><button className="text-button" onClick={() => setCompare([])}>Clear</button></div><div className="table-scroll"><table><thead><tr><th>Model</th><th>Configuration</th><th>Success</th><th>Median task time</th><th>Output tokens</th></tr></thead><tbody>{compared.map(run => <tr key={run.id}><td>{run.config.model}</td><td>Pi {run.versions.pi} · {run.config.tasks.length} tasks × {run.config.repeats}<small>{run.config.reasoning} reasoning · {run.config.maxTurns} turns</small></td><td>{percent(run.summary?.successRate)}{run.summary && <small>{run.summary.passed + run.summary.failed}/{run.summary.expected} graded</small>}</td><td>{duration(run.summary?.medianSeconds)}</td><td>{number(run.summary?.outputTokens)}</td></tr>)}</tbody></table></div><p className="comparison-note">{matching ? 'Task versions, harness and budgets match. Also compare model server settings and hardware.' : 'These runs use different task versions, harness settings or budgets; treat them as separate experiments.'}</p></section>}
          <section className="panel result-panel"><div className="table-scroll"><table><thead><tr><th><span className="sr-only">Compare</span></th><th>Model</th><th>Benchmark</th><th>Status</th><th>Success</th><th>Started</th><th/></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td><input type="checkbox" aria-label={`Compare run ${run.id}`} disabled={run.config.kind !== 'tasks' || busy(run.status)} checked={compare.includes(run.id)} onChange={() => setCompare(toggle(compare, run.id))}/></td><td><strong>{run.config.model}</strong><small>{run.id.slice(0, 8)}</small></td><td>{run.config.kind === 'tasks' ? 'Verified tasks' : 'Serving performance'}</td><td><Badge status={run.status}/></td><td>{percent(run.summary?.successRate)}{run.summary && <small>{run.summary.passed + run.summary.failed}/{run.summary.expected} graded</small>}</td><td>{date(run.createdAt)}</td><td><button className="text-button" onClick={() => openRun(run.id)} aria-label={`Inspect run ${run.id}`}><Icon name="arrow"/></button></td></tr>)}{!runs.length && <tr><td colSpan="7" className="empty-cell">Your first benchmark starts here.<button className="text-button" onClick={goNew}>Create a run →</button></td></tr>}</tbody></table></div></section>
        </>}
        <footer><span>the-benchmark</span><span>Local models. Observable work.</span><span className="mono">v0.4.0</span></footer>
      </div>
    </main>
    {file && <div className="modal-backdrop" onClick={() => setFile(null)}><section className="file-modal" role="dialog" aria-modal="true" aria-label="File inspector" onClick={e => e.stopPropagation()}><div className="panel-heading"><h2>{file.path}</h2><button className="text-button" onClick={() => setFile(null)} aria-label="Close file inspector"><Icon name="close"/></button></div><pre>{file.text}</pre></section></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
