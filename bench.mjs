#!/usr/bin/env node
// Minimal LLM server benchmark. Works against any OpenAI-compatible /v1 endpoint
// (LM Studio, Ollama, llama.cpp server, vLLM). Zero dependencies.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const TARGETS = { lmstudio: 'http://localhost:1234', ollama: 'http://localhost:11434' };

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  const isFlag = next === undefined || next.startsWith('--');
  args[a.slice(2)] = isFlag ? true : process.argv[++i];
}
const target = args.target ?? 'lmstudio';
const base = (args.url ?? TARGETS[target] ?? TARGETS.lmstudio).replace(/\/$/, '');
const runs = Number(args.runs ?? 3);
const genTokens = Number(args['gen-tokens'] ?? 256);
const sizes = String(args.sizes ?? '256,2048,8192').split(',').map(Number);
const PHASES = ['prefill', 'generation', 'agentic'];
const phases = String(args.phases ?? 'prefill,generation').split(',').map((s) => s.trim()).filter(Boolean);
const badPhase = phases.find((p) => !PHASES.includes(p));
if (badPhase) {
  console.error(`unknown phase "${badPhase}"; expected one or more of: ${PHASES.join(', ')}`);
  process.exit(1);
}
const maxTurns = Number(args['max-turns'] ?? 12);
const turnTokens = Number(args['turn-tokens'] ?? 4096);
const turnTimeout = Number(args['turn-timeout'] ?? 180) * 1000;
const reasoning = typeof args.reasoning === 'string' ? args.reasoning : null;
const outRoot = resolve(String(args.out ?? 'out'));

const die = (e) => {
  const msg = e?.cause?.code ?? e?.message ?? String(e);
  console.error(`\nbench failed: ${msg}`);
  console.error(`  target: ${base}`);
  console.error('  check the server is running and a model is loaded.');
  process.exit(1);
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);

// One token per word for the filler; actual counts come from the server's usage block.
const FILLER = 'benchmark filler token sequence for deterministic prompt length measurement '.trim().split(' ');
// Unique per process, not just per run: a plain counter restarts at 0 every
// invocation, so back-to-back runs would send byte-identical prompts and get
// served from the backend's on-disk prompt cache.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const buildPrompt = (approxTokens, nonce) =>
  // Nonce goes FIRST so prompt caching cannot serve a shared prefix.
  `run-${RUN_ID}-${nonce}. ` + Array.from({ length: approxTokens }, (_, i) => FILLER[i % FILLER.length]).join(' ');

async function resolveModel() {
  if (args.model) return args.model;
  // LM Studio's native endpoint reports load state; prefer an already-loaded model.
  try {
    const r = await fetch(`${base}/api/v0/models`);
    if (r.ok) {
      const loaded = (await r.json()).data.find((m) => m.state === 'loaded' && m.type !== 'embeddings');
      if (loaded) return loaded;
    }
  } catch {}
  const r = await fetch(`${base}/v1/models`);
  if (!r.ok) throw new Error(`cannot reach ${base}/v1/models (${r.status})`);
  const first = (await r.json()).data?.[0]?.id;
  if (!first) throw new Error('no models available; load one first');
  return { id: first };
}

// One request. Streams, times it, and accumulates any tool calls the model emits.
class Stalled extends Error {}

async function chat({ messages, tools, maxTokens, timeoutMs }) {
  const started = performance.now();
  const abort = new AbortController();
  const timer = timeoutMs ? setTimeout(() => abort.abort(), timeoutMs) : null;
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  // Thinking budget. 'none' is the only reliable way to stop some models
  // reasoning straight through their whole output budget without ever acting.
  if (reasoning) body.reasoning_effort = reasoning;
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer bench' },
    body: JSON.stringify(body),
    signal: abort.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let ttft = null, chunks = 0, usage = null, buf = '', content = '', finishReason = null;
  const toolCalls = [];
  const mark = () => {
    if (ttft === null) ttft = performance.now() - started;
    chunks++;
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.usage) usage = ev.usage;
      const choice = ev.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta;
      if (!delta) continue;
      if (delta.content) { content += delta.content; mark(); }
      if (delta.reasoning_content) mark();
      // Tool calls stream as fragments keyed by index; name and arguments arrive in pieces.
      for (const tc of delta.tool_calls ?? []) {
        const slot = (toolCalls[tc.index ?? 0] ??= { id: '', name: '', args: '' });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        mark();
      }
    }
  }
  } catch (e) {
    if (abort.signal.aborted) throw new Stalled(`no completion within ${(timeoutMs / 1000).toFixed(0)}s`);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const total = performance.now() - started;
  // Fall back to chunk count when the server omits usage (older Ollama builds).
  const outTokens = usage?.completion_tokens ?? chunks;
  return {
    ttftMs: ttft ?? total,
    totalMs: total,
    promptTokens: usage?.prompt_tokens ?? null,
    outTokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    approximate: !usage,
    prefillTps: usage?.prompt_tokens ? usage.prompt_tokens / ((ttft ?? total) / 1000) : null,
    genTps: outTokens > 1 ? (outTokens - 1) / ((total - (ttft ?? 0)) / 1000) : null,
    content,
    toolCalls: toolCalls.filter(Boolean),
    finishReason,
  };
}

const measure = (prompt, maxTokens) => chat({ messages: [{ role: 'user', content: prompt }], maxTokens });

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n, d = 1) => (n == null ? '—' : n.toFixed(d));
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
const secondsAndMinutes = (seconds) => `${seconds.toFixed(1)}s (${(seconds / 60).toFixed(2)}m)`;

const info = await resolveModel();
const model = info.id;
console.log(`target   ${target}  ${base}`);
console.log(`model    ${model}`);
if (info.compatibility_type || info.quantization || info.loaded_context_length) {
  const bits = [info.compatibility_type, info.quantization, info.loaded_context_length && `${info.loaded_context_length.toLocaleString('en-US')} ctx`];
  console.log(`runtime  ${bits.filter(Boolean).join(' · ')}`);
}
console.log(`phases   ${phases.join(', ')}`);
if (reasoning) console.log(`reason   reasoning_effort=${reasoning}`);
if (phases.some((p) => p === 'prefill' || p === 'generation')) console.log(`runs     ${runs} per size (median reported)`);
console.log('');

let nonce = 0;
const results = [];

// ---------------------------------------------------------------------------
// Agentic coding: a real plan → act → finish loop over tools, not a single
// completion. Measures what actually decides whether a local model is usable as
// a coding agent: does it emit well-formed tool calls, does it converge, and how
// fast does it stay as the transcript grows.
// ---------------------------------------------------------------------------

const APP_TASK = `Build a small self-contained web app: a single-page tip calculator.

Requirements:
- Exactly three files: index.html, styles.css, app.js
- index.html links styles.css and app.js. No CDNs, no frameworks, no build step.
- Inputs: bill amount, tip percentage, number of people
- Live output: tip amount, total, and per-person share
- Keyboard accessible, and works offline

Process:
1. Call plan first with your ordered steps.
2. Then call write_file once per file, with the complete file contents.
3. Then call finish with a one-paragraph summary.

Call exactly one tool per message. Never put code in your prose — code goes in write_file.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'plan',
      description: 'Record your ordered plan. Call this once, before writing any code.',
      parameters: {
        type: 'object',
        properties: { steps: { type: 'array', items: { type: 'string' }, description: 'Ordered steps you will take' } },
        required: ['steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with its complete contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, e.g. index.html' },
          content: { type: 'string', description: 'The entire file contents' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List the files written so far.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read back a file you already wrote.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative path to read' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call when every file is written and the app is complete.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'One paragraph on what you built' } },
        required: ['summary'],
      },
    },
  },
];

// Files live in memory during the run and are flushed to disk at the end, so a
// malformed tool call can never touch the working tree.
const vfs = new Map();
const stats = { toolCalls: 0, malformed: 0, unknown: 0, noToolTurns: 0, cappedTurns: 0, stalledTurns: 0, plan: null, summary: null };

// The model picks these paths. Keep them inside the run directory.
const safePath = (p) => {
  const clean = String(p ?? '').trim().replace(/^[./\\]+/, '');
  if (!clean || clean.split(/[/\\]/).some((seg) => seg === '..' || seg === '')) return null;
  return clean.split(/[/\\]/).join('/');
};

function runTool(name, rawArgs) {
  stats.toolCalls++;
  let a;
  try {
    a = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    stats.malformed++;
    return { label: `${name}(malformed args)`, out: 'ERROR: your arguments were not valid JSON. Retry with valid JSON.' };
  }
  switch (name) {
    case 'plan': {
      const steps = Array.isArray(a.steps) ? a.steps : [];
      stats.plan ??= steps;
      return { label: `plan(${steps.length} steps)`, out: `Plan recorded (${steps.length} steps). Now write the files.` };
    }
    case 'write_file': {
      const path = safePath(a.path);
      if (!path) return { label: `write_file(rejected path)`, out: 'ERROR: unsafe or missing path. Use a plain relative filename.' };
      const content = typeof a.content === 'string' ? a.content : '';
      if (!content) return { label: `write_file(${path}, empty)`, out: 'ERROR: content was empty. Send the complete file.' };
      vfs.set(path, content);
      return { label: `write_file(${path}, ${kb(content)})`, out: `Wrote ${path} (${Buffer.byteLength(content)} bytes).` };
    }
    case 'list_files':
      return { label: `list_files(${vfs.size})`, out: vfs.size ? [...vfs.keys()].join('\n') : '(no files yet)' };
    case 'read_file': {
      const path = safePath(a.path);
      if (!path || !vfs.has(path)) return { label: `read_file(${path ?? '?'}, missing)`, out: `ERROR: no such file. Files: ${[...vfs.keys()].join(', ') || '(none)'}` };
      return { label: `read_file(${path})`, out: vfs.get(path) };
    }
    case 'finish':
      stats.summary = typeof a.summary === 'string' ? a.summary : '';
      return { label: 'finish', out: 'Done.', done: true };
    default:
      stats.unknown++;
      return { label: `${name}(unknown tool)`, out: `ERROR: no tool named ${name}. Available: plan, write_file, list_files, read_file, finish.` };
  }
}


// ---------------------------------------------------------------------------
// Metric dictionary — one source of truth for the short column key, the
// human-readable name, the abbreviation people actually say out loud, and what
// the number means. The CLI prints the keys; the report prints all of it.
// ---------------------------------------------------------------------------

const METRICS = {
  prompt_tok: {
    name: 'Prompt size', unit: 'tokens', better: null,
    what: 'How much input was sent, counted by the server itself rather than estimated locally, so it is exact.',
  },
  ttft_ms: {
    name: 'Time to first token', abbr: 'TTFT', unit: 'ms', better: 'lower',
    what: 'From sending the request to the first token arriving. In the prompt-processing phase max_tokens is 1, so essentially all of it is prompt-processing cost. In the generation phase the prompt is tiny, so it is the request latency floor instead.',
  },
  prefill_tok_s: {
    name: 'Prompt read speed', cli: 'prefill_tok/s', unit: 'tok/s', better: 'higher',
    what: 'Prompt size divided by time to first token — how fast the model digests input. Compute-bound, and the number that decides how long a large context takes to load.',
  },
  out_tok: {
    name: 'Output length', unit: 'tokens', better: null,
    what: 'Tokens the model produced, thinking included.',
  },
  gen_tok_s: {
    name: 'Output write speed', cli: 'gen_tok/s', unit: 'tok/s', better: 'higher',
    what: 'Steady-state decode rate with prefill excluded: (out_tok - 1) / (total - TTFT). Memory-bandwidth-bound, and what you feel while watching text stream.',
  },
  think_tok: {
    name: 'Thinking tokens', unit: 'tokens', better: 'lower',
    what: 'The slice of the output spent reasoning internally rather than answering. A subset of output length, not an addition to it. When it equals the output length the model produced nothing usable.',
  },
  took_s: {
    name: 'Time taken', cli: 'took_s · took_min', unit: 's · min', better: 'lower',
    what: 'Wall-clock for this row, covering every repeat run it summarises. Shown in both seconds and minutes; JSON retains seconds as the canonical value.',
  },
  turn: {
    name: 'Turn', unit: null, better: null,
    what: 'One round trip of the agent loop: the model responds, its tool call is executed, and the result is fed back as a tool message.',
  },
  ctx_tok: {
    name: 'Context size', unit: 'tokens', better: null,
    what: 'Everything sent this turn — the entire transcript so far. It grows every turn, which is what makes long agent sessions expensive regardless of speed.',
  },
  action: {
    name: 'Action', unit: null, better: null,
    what: 'The tool call the turn produced, with its arguments summarised — or a note that the turn produced no call at all.',
  },
};

const SUMMARY_FIELDS = {
  finished: 'Whether the model called finish, or instead ran into the turn cap or a stall. The single most important line: everything else describes a run that may not have worked.',
  wall_clock_s: 'End-to-end time for the whole agent loop, every turn and tool call included.',
  wall_clock_min: 'The same end-to-end agent-loop time converted to minutes for easier scanning.',
  turns_used: 'Round trips consumed out of the --max-turns budget. The theoretical minimum for this task is 5: plan, three files, finish.',
  tool_calls: 'Total calls, with malformed (arguments were not valid JSON) and unknown (a tool that does not exist) broken out. Non-zero counts here are the usual reason a local model cannot be used as an agent.',
  turns_without_a_tool_call: 'Turns that produced prose but no action, and how many of those ran out of output budget mid-thought.',
  stalled_turns: 'Turns that never returned inside the --turn-timeout deadline. The run stops at the first one.',
  files_written: 'What actually landed on disk, by name.',
  plan_steps: 'How many steps the model committed to up front, or a note that it never planned at all.',
  input_tok_total: 'Every context size added up — the cost of re-reading the transcript on each turn. Compare it to output to see the re-prefill tax.',
  output_tok_total: 'Every output length added up: the tokens that did productive work.',
  thinking_tok_total: 'Reasoning tokens across the whole run.',
  decode_tok_s_median: 'Median output write speed across turns, so one slow late turn cannot hide behind a fast first one.',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A table header cell carrying the human name, the column key and the unit.
const th = (key, align = 'right') => {
  const m = METRICS[key] ?? { name: key };
  const shown = m.cli ?? key;
  const code = m.abbr ? `${shown} · ${m.abbr}` : shown;
  return `<th class="${align}"><span class="hname">${esc(m.name)}</span><span class="hcode">${esc(code)}${m.unit ? ` (${esc(m.unit)})` : ''}</span></th>`;
};

const glossary = (keys) => `<table class="gloss">
<tr><th>Metric</th><th>Column</th><th>Unit</th><th>Better</th><th>What it measures</th></tr>
${keys.map((k) => {
  const m = METRICS[k];
  return `<tr><th>${esc(m.name)}${m.abbr ? ` <span class="hcode">(${esc(m.abbr)})</span>` : ''}</th><td><code>${esc(m.cli ?? k)}</code></td><td>${esc(m.unit ?? '—')}</td><td>${m.better ? esc(m.better) : '—'}</td><td class="left">${esc(m.what)}</td></tr>`;
}).join('\n')}
</table>`;

function writeRunReport(dir, run) {
  const { prefill, generation, agentic, timings, totalS } = run;

  const phaseTimes = `<table class="times">
<tr><th class="left">Benchmark</th><th>Time taken</th><th>Share of run</th></tr>
${timings.map((t) => `<tr><th class="left">${esc(t.label)}</th><td>${secondsAndMinutes(t.seconds)}</td><td>${((t.seconds / totalS) * 100).toFixed(0)}%</td></tr>`).join('\n')}
<tr class="total"><th class="left">Whole run</th><td>${secondsAndMinutes(totalS)}</td><td>100%</td></tr>
</table>`;

  const prefillSection = !prefill ? '' : `<section>
<h2>Prompt processing <span class="sub">how fast the model reads</span></h2>
<p class="lede">Each row sends a fresh prompt of the given size with <code>max_tokens=1</code>, so the request finishes the moment prefill does. ${runs} run${runs === 1 ? '' : 's'} per size, median reported. Every run is prefixed with a unique nonce so prompt caching cannot turn this into a cache-hit test.</p>
<table>
<tr>${th('prompt_tok')}${th('ttft_ms')}${th('prefill_tok_s')}${th('took_s')}</tr>
${prefill.map((r) => `<tr><td>${r.promptTokens ?? '—'}</td><td>${fmt(r.ttftMs)}</td><td>${fmt(r.prefillTps)}</td><td>${secondsAndMinutes(r.seconds)}</td></tr>`).join('\n')}
</table>
<p class="note">The smallest row is a latency artefact, not a throughput measurement — at a few hundred tokens the request round trip dominates. Trust the largest size you ran.</p>
${glossary(['prompt_tok', 'ttft_ms', 'prefill_tok_s', 'took_s'])}
</section>`;

  const genSection = !generation ? '' : `<section>
<h2>Generation <span class="sub">how fast the model writes</span></h2>
<p class="lede">A short prompt with <code>max_tokens=${genTokens}</code>, so the timing is dominated by decoding rather than reading. Prefill is subtracted out.</p>
<table>
<tr>${th('out_tok')}${th('ttft_ms')}${th('gen_tok_s')}${th('think_tok')}${th('took_s')}</tr>
<tr><td>${generation.outTokens}</td><td>${fmt(generation.ttftMs)}</td><td>${fmt(generation.genTps, 2)}</td><td>${generation.reasoningTokens ?? 0}</td><td>${secondsAndMinutes(generation.seconds)}</td></tr>
</table>
${glossary(['out_tok', 'ttft_ms', 'gen_tok_s', 'think_tok', 'took_s'])}
</section>`;

  const agenticSection = !agentic ? '' : `<section>
<h2>Agentic coding <span class="sub">can it actually drive tools</span></h2>
<p class="lede">The model is given five tools — <code>plan</code>, <code>write_file</code>, <code>list_files</code>, <code>read_file</code>, <code>finish</code> — and asked to build a three-file tip calculator: plan first, write each file, then finish. Each turn is capped at <code>${turnTokens}</code> output tokens and <code>${turnTimeout / 1000}s</code>.</p>
<table>
<tr>${th('turn')}${th('ctx_tok')}${th('ttft_ms')}${th('out_tok')}${th('think_tok')}${th('gen_tok_s')}${th('took_s')}${th('action', 'left')}</tr>
${agentic.turns.map((t) => `<tr><td>${t.turn}</td><td>${t.ctxTok ?? '—'}</td><td>${t.ttftMs == null ? '—' : fmt(t.ttftMs)}</td><td>${t.outTok || '—'}</td><td>${t.reasoningTok ?? 0}</td><td>${t.genTps == null ? '—' : fmt(t.genTps, 2)}</td><td>${t.seconds == null ? '—' : secondsAndMinutes(t.seconds)}</td><td class="left">${esc(t.action)}</td></tr>`).join('\n')}
</table>
<h3>Result</h3>
<table class="gloss">
<tr><th>Field</th><th>Value</th><th>What it means</th></tr>
${Object.entries(agentic.summary).map(([k, v]) => `<tr><th>${esc(k.replace(/_/g, ' '))}</th><td><strong>${esc(v)}</strong></td><td class="left">${esc(SUMMARY_FIELDS[k] ?? '')}</td></tr>`).join('\n')}
</table>
${glossary(['turn', 'ctx_tok', 'ttft_ms', 'out_tok', 'think_tok', 'gen_tok_s', 'took_s', 'action'])}
<h3>What it built</h3>
${agentic.files.length ? `<iframe src="app/index.html" title="The app the model generated"></iframe>` : '<p class="note">No files were produced.</p>'}
${agentic.files.map(([p, c]) => `<details><summary>${esc(p)} <span class="hcode">${kb(c)}</span></summary><pre>${esc(c)}</pre></details>`).join('\n')}
</section>`;

  writeFileSync(join(dir, 'report.html'), `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model)} — benchmark run</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 15%, transparent); --soft: color-mix(in srgb, currentColor 6%, transparent) }
  * { box-sizing: border-box }
  body { font: 15px/1.6 system-ui, -apple-system, sans-serif; max-width: 74rem; margin: 0 auto; padding: 3rem 1.5rem 6rem }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem }
  h2 { font-size: 1.2rem; margin: 0 0 .4rem }
  h3 { font-size: 1rem; margin: 2rem 0 .5rem }
  section { margin: 3.5rem 0 0; padding-top: 2rem; border-top: 1px solid var(--line) }
  .sub { font-weight: 400; opacity: .55; font-size: .85em }
  .lede { margin: 0 0 1.25rem; max-width: 62ch; opacity: .85 }
  .note { max-width: 62ch; opacity: .7; font-size: .9em; margin: .75rem 0 0 }
  .meta { opacity: .6; margin: 0 0 2rem }
  table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; font-variant-numeric: tabular-nums }
  th, td { padding: .45rem .7rem; border-bottom: 1px solid var(--line); text-align: right; vertical-align: top }
  thead th, tr:first-child th { white-space: nowrap }
  .left, th.left, td.left { text-align: left }
  th { font-weight: 600 }
  .hname { display: block }
  .hcode { display: block; font: 400 .78em ui-monospace, SFMono-Regular, Menlo, monospace; opacity: .55 }
  code { font: .9em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--soft); padding: .1em .35em; border-radius: .25em }
  .gloss { font-size: .9em; margin-top: 1.5rem }
  .gloss th { text-align: left; font-weight: 600; white-space: nowrap }
  .gloss td.left { opacity: .8 }
  .times th.left { font-weight: 600 }
  .times tr.total th, .times tr.total td { border-top: 2px solid var(--line); font-weight: 700 }
  pre { overflow-x: auto; padding: 1rem; background: var(--soft); border-radius: .5rem; font-size: .85em; line-height: 1.5 }
  iframe { width: 100%; height: 34rem; border: 1px solid var(--line); border-radius: .5rem; background: #fff; margin-bottom: 1rem }
  details { border-bottom: 1px solid var(--line) }
  summary { cursor: pointer; padding: .5rem 0 }
  .wrap { overflow-x: auto }
</style>

<h1>Benchmark run</h1>
<p class="meta">${esc(model)}${info.quantization ? ` · ${esc([info.compatibility_type, info.quantization, info.loaded_context_length && `${info.loaded_context_length.toLocaleString('en-US')} ctx`].filter(Boolean).join(' · '))}` : ''}<br>
${esc(target)} · ${esc(base)}${reasoning ? ` · reasoning_effort=${esc(reasoning)}` : ''}</p>

<h2>Time taken <span class="sub">per benchmark</span></h2>
<p class="lede">Wall-clock for each phase that ran, so a fast number in a slow phase is obvious. The warmup request is excluded — it exists only so model loading is not counted in the first result.</p>
${phaseTimes}
${prefillSection}
${genSection}
${agenticSection}
`);
}

// ---------------------------------------------------------------------------
// Run the phases
// ---------------------------------------------------------------------------

const runStarted = performance.now();
const timings = [];
const run = { prefill: null, generation: null, agentic: null };

// Warmup: loads/JITs the model so the first real run is not measuring startup.
process.stdout.write('warmup... ');
await measure(buildPrompt(64, `warm-${nonce++}`), 8);
console.log('done');

if (phases.includes('prefill')) {
  const t0 = performance.now();
  console.log('\nPROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run');
  console.log('  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)');
  const rows = [];
  for (const size of sizes) {
    const s0 = performance.now();
    const rs = [];
    for (let i = 0; i < runs; i++) rs.push(await measure(buildPrompt(size, `p${size}-${nonce++}`), 1));
    const r = {
      phase: 'prefill', size, promptTokens: rs[0].promptTokens,
      ttftMs: median(rs.map((x) => x.ttftMs)), prefillTps: median(rs.map((x) => x.prefillTps)),
      seconds: (performance.now() - s0) / 1000,
    };
    rows.push(r);
    results.push({ ...r, raw: rs });
    console.log(`  ${String(r.promptTokens ?? size).padStart(10)}${fmt(r.ttftMs).padStart(11)}${fmt(r.prefillTps).padStart(17)}${secondsAndMinutes(r.seconds).padStart(28)}`);
  }
  run.prefill = rows;
  const secs = (performance.now() - t0) / 1000;
  timings.push({ label: 'Prompt processing', seconds: secs });
  console.log(`  total ${secondsAndMinutes(secs)} for ${sizes.length} size${sizes.length === 1 ? '' : 's'} × ${runs} run${runs === 1 ? '' : 's'}`);
}

if (phases.includes('generation')) {
  const t0 = performance.now();
  console.log(`\nGENERATION  — max_tokens=${genTokens}, short prompt`);
  console.log('  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)');
  const rs = [];
  for (let i = 0; i < runs; i++) rs.push(await measure(buildPrompt(64, `g-${nonce++}`) + ' Write a long detailed essay about distributed systems.', genTokens));
  const secs = (performance.now() - t0) / 1000;
  const r = {
    phase: 'generation', outTokens: median(rs.map((x) => x.outTokens)), ttftMs: median(rs.map((x) => x.ttftMs)),
    genTps: median(rs.map((x) => x.genTps)), reasoningTokens: median(rs.map((x) => x.reasoningTokens)), seconds: secs,
  };
  run.generation = r;
  results.push({ ...r, raw: rs });
  console.log(`  ${String(r.outTokens).padStart(7)}${fmt(r.ttftMs).padStart(11)}${fmt(r.genTps, 2).padStart(13)}${String(r.reasoningTokens ?? 0).padStart(16)}${secondsAndMinutes(secs).padStart(28)}`);
  if (rs[0].approximate) console.log('  note: server returned no usage block; out_tok is an approximation from stream chunks');
  timings.push({ label: 'Generation', seconds: secs });
  console.log(`  total ${secondsAndMinutes(secs)} for ${runs} run${runs === 1 ? '' : 's'}`);
}

if (phases.includes('agentic')) {
  console.log(`\nAGENTIC CODING  — plan → write files → finish, max ${maxTurns} turns, ${turnTokens} max_tokens/turn`);
  console.log('  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action');

  const messages = [
    { role: 'system', content: 'You are a coding agent. You act only by calling the provided tools. Do not describe code in prose — write it with write_file. Keep your reasoning to a few sentences: decide, then call the tool. Do not draft the file in your reasoning — write it straight into write_file.' },
    { role: 'user', content: APP_TASK },
  ];
  const turns = [];
  const startedAll = performance.now();
  let finished = false;
  let stalled = null;

  for (let turn = 1; turn <= maxTurns && !finished; turn++) {
    let r;
    try {
      r = await chat({ messages, tools: TOOLS, maxTokens: turnTokens, timeoutMs: turnTimeout });
    } catch (e) {
      if (!(e instanceof Stalled)) throw e;
      // A model that will not answer inside the deadline is a result, not a crash.
      stats.stalledTurns++;
      stalled = e.message;
      turns.push({ turn, ctxTok: null, ttftMs: null, outTok: 0, genTps: null, reasoningTok: 0, seconds: turnTimeout / 1000, action: `STALLED — ${e.message}` });
      console.log(`  ${String(turn).padStart(4)}${'—'.padStart(11)}${'—'.padStart(16)}${'—'.padStart(11)}${'—'.padStart(13)}${'—'.padStart(13)}${secondsAndMinutes(turnTimeout / 1000).padStart(28)}   STALLED — ${e.message}`);
      break;
    }
    let action;

    if (!r.toolCalls.length) {
      // A turn with prose but no tool call is itself a result worth counting.
      stats.noToolTurns++;
      if (r.finishReason === 'length') stats.cappedTurns++;
      action = r.finishReason === 'length' ? `no tool call (hit the ${turnTokens}-token cap)` : 'no tool call';
      messages.push({ role: 'assistant', content: r.content || '' });
      messages.push({
        role: 'user',
        content: r.finishReason === 'length'
          ? 'You ran out of output budget before calling a tool. Think less and call exactly one tool immediately.'
          : 'You did not call a tool. Call exactly one tool now.',
      });
    } else {
      messages.push({
        role: 'assistant',
        content: r.content || '',
        tool_calls: r.toolCalls.map((tc, i) => ({
          id: tc.id || `call_${turn}_${i}`,
          type: 'function',
          function: { name: tc.name, arguments: tc.args || '{}' },
        })),
      });
      const labels = [];
      for (const [i, tc] of r.toolCalls.entries()) {
        const res = runTool(tc.name, tc.args);
        labels.push(res.label);
        messages.push({ role: 'tool', tool_call_id: tc.id || `call_${turn}_${i}`, content: res.out });
        if (res.done) finished = true;
      }
      action = labels.join(' + ');
    }

    turns.push({ turn, ctxTok: r.promptTokens, ttftMs: r.ttftMs, outTok: r.outTokens, genTps: r.genTps, reasoningTok: r.reasoningTokens, seconds: r.totalMs / 1000, action });
    console.log(`  ${String(turn).padStart(4)}${String(r.promptTokens ?? '—').padStart(11)}${fmt(r.ttftMs).padStart(16)}${String(r.outTokens).padStart(11)}${String(r.reasoningTokens ?? 0).padStart(13)}${fmt(r.genTps, 2).padStart(13)}${secondsAndMinutes(r.totalMs / 1000).padStart(28)}   ${action}`);
  }

  const wallS = (performance.now() - startedAll) / 1000;
  timings.push({ label: 'Agentic coding', seconds: wallS });

  const summary = {
    finished: finished
      ? 'yes — called finish'
      : stalled
        ? `no — stalled (${stalled})`
        : `no — stopped at the ${maxTurns}-turn cap`,
    wall_clock_s: wallS.toFixed(1),
    wall_clock_min: (wallS / 60).toFixed(2),
    turns_used: `${turns.length} / ${maxTurns}`,
    tool_calls: `${stats.toolCalls} (${stats.malformed} malformed, ${stats.unknown} unknown)`,
    turns_without_a_tool_call: `${stats.noToolTurns}${stats.cappedTurns ? ` — ${stats.cappedTurns} of them ran out of output budget mid-thought` : ''}`,
    stalled_turns: `${stats.stalledTurns} (${turnTimeout / 1000}s deadline per turn)`,
    files_written: `${vfs.size}${vfs.size ? ` — ${[...vfs.keys()].join(', ')}` : ''}`,
    plan_steps: stats.plan ? String(stats.plan.length) : 'never called plan',
    input_tok_total: sum(turns.map((t) => t.ctxTok)).toLocaleString('en-US'),
    output_tok_total: sum(turns.map((t) => t.outTok)).toLocaleString('en-US'),
    thinking_tok_total: sum(turns.map((t) => t.reasoningTok)).toLocaleString('en-US'),
    decode_tok_s_median: fmt(median(turns.map((t) => t.genTps)), 2),
  };
  run.agentic = { turns, summary, files: [...vfs.entries()] };
  results.push({ phase: 'agentic', wallS, turns, ...stats, files: [...vfs.keys()] });

  console.log('\n  AGENTIC SUMMARY');
  const w = Math.max(...Object.keys(summary).map((k) => k.length)) + 2;
  for (const [k, v] of Object.entries(summary)) console.log(`    ${k.padEnd(w)}${v}`);
}

// ---------------------------------------------------------------------------
// Write the run report
// ---------------------------------------------------------------------------

const totalS = (performance.now() - runStarted) / 1000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = join(outRoot, `run-${stamp}`);
const appDir = join(runDir, 'app');
mkdirSync(runDir, { recursive: true });
for (const [path, content] of vfs) {
  const dest = join(appDir, path);
  // Belt and braces: safePath already rejected traversal, verify containment.
  if (!resolve(dest).startsWith(resolve(appDir) + sep)) continue;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
writeRunReport(runDir, { ...run, timings, totalS });

console.log('\nTIME TAKEN');
const tw = Math.max(...timings.map((t) => t.label.length)) + 2;
for (const t of timings) console.log(`  ${t.label.padEnd(tw)}${secondsAndMinutes(t.seconds)}`);
console.log(`  ${'Whole run'.padEnd(tw)}${secondsAndMinutes(totalS)}`);

console.log(`\nreport   ${join(runDir, 'report.html')}`);
if (vfs.has('index.html')) console.log(`app      ${join(appDir, 'index.html')}`);

if (args.json) console.log('\n' + JSON.stringify({ target, base, model, runs, totalS, timings, results }, null, 2));
