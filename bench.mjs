#!/usr/bin/env node
// Minimal LLM server benchmark. Works against any OpenAI-compatible /v1 endpoint
// (LM Studio, Ollama, llama.cpp server, vLLM). Zero dependencies.

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
const buildPrompt = (approxTokens, nonce) =>
  // Nonce goes FIRST so prompt caching cannot serve a shared prefix between runs.
  `run-${nonce}. ` + Array.from({ length: approxTokens }, (_, i) => FILLER[i % FILLER.length]).join(' ');

async function resolveModel() {
  if (args.model) return args.model;
  // LM Studio's native endpoint reports load state; prefer an already-loaded model.
  try {
    const r = await fetch(`${base}/api/v0/models`);
    if (r.ok) {
      const loaded = (await r.json()).data.find((m) => m.state === 'loaded' && m.type !== 'embeddings');
      if (loaded) return loaded.id;
    }
  } catch {}
  const r = await fetch(`${base}/v1/models`);
  if (!r.ok) throw new Error(`cannot reach ${base}/v1/models (${r.status})`);
  const first = (await r.json()).data?.[0]?.id;
  if (!first) throw new Error('no models available; load one first');
  return first;
}

async function measure(model, prompt, maxTokens) {
  const started = performance.now();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer bench' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let ttft = null, chunks = 0, usage = null, buf = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
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
      const delta = ev.choices?.[0]?.delta;
      if (delta && (delta.content || delta.reasoning_content)) {
        if (ttft === null) ttft = performance.now() - started;
        chunks++;
      }
    }
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
  };
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n, d = 1) => (n == null ? '—' : n.toFixed(d));

const model = await resolveModel();
console.log(`target   ${target}  ${base}`);
console.log(`model    ${model}`);
console.log(`runs     ${runs} per size (median reported)\n`);

let nonce = 0;
const results = [];

// Warmup: loads/JITs the model so the first real run is not measuring startup.
process.stdout.write('warmup... ');
await measure(model, buildPrompt(64, `warm-${nonce++}`), 8);
console.log('done\n');

console.log('PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run');
console.log('  prompt_tok    ttft_ms    prefill_tok/s');
for (const size of sizes) {
  const rs = [];
  for (let i = 0; i < runs; i++) rs.push(await measure(model, buildPrompt(size, `p${size}-${nonce++}`), 1));
  const r = { phase: 'prefill', size, promptTokens: rs[0].promptTokens, ttftMs: median(rs.map((x) => x.ttftMs)), prefillTps: median(rs.map((x) => x.prefillTps)) };
  results.push({ ...r, raw: rs });
  console.log(`  ${String(r.promptTokens ?? size).padStart(10)}${fmt(r.ttftMs).padStart(11)}${fmt(r.prefillTps).padStart(17)}`);
}

console.log(`\nGENERATION  — max_tokens=${genTokens}, short prompt`);
console.log('  out_tok    ttft_ms    gen_tok/s   reasoning_tok');
{
  const rs = [];
  for (let i = 0; i < runs; i++) rs.push(await measure(model, buildPrompt(64, `g-${nonce++}`) + ' Write a long detailed essay about distributed systems.', genTokens));
  const r = { phase: 'generation', outTokens: median(rs.map((x) => x.outTokens)), ttftMs: median(rs.map((x) => x.ttftMs)), genTps: median(rs.map((x) => x.genTps)), reasoningTokens: median(rs.map((x) => x.reasoningTokens)) };
  results.push({ ...r, raw: rs });
  console.log(`  ${String(r.outTokens).padStart(7)}${fmt(r.ttftMs).padStart(11)}${fmt(r.genTps, 2).padStart(13)}${String(r.reasoningTokens ?? 0).padStart(16)}`);
  if (rs[0].approximate) console.log('  note: server returned no usage block; out_tok is an approximation from stream chunks');
}

if (args.json) console.log('\n' + JSON.stringify({ target, base, model, runs, results }, null, 2));
