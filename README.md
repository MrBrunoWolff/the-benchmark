# the-benchmark

Minimal local-LLM server benchmark. One code path, zero dependencies — only the
base URL changes between backends.

Works against any OpenAI-compatible `/v1/chat/completions` endpoint: LM Studio,
Ollama, llama.cpp server, vLLM.

## Run it without cloning

One file, zero dependencies, nothing to clone. Load a model in LM Studio or Ollama
first — the backend is auto-detected.

```bash
bunx the-benchmark                                     # prefill + generation, under a minute
bunx the-benchmark --phases prefill,generation,agentic # everything, several minutes
npx -y the-benchmark                                   # same, via npm
```

Published as [`the-benchmark`](https://www.npmjs.com/package/the-benchmark) — 4
files, no dependencies, Node 18+.

If you keep a supply-chain delay on npm installs, a freshly published version is
refused until it ages out:

```
error: Package "the-benchmark" ... blocked by minimum-release-age: 259200 seconds
```

That is your own guard doing its job, not a broken package — bun reads
`minimumReleaseAge` from `~/.bunfig.toml`, and neither `--minimum-release-age=0` nor
a local `bunfig.toml` overrides it for `bunx`. Wait it out, or use the file form,
which needs nothing but Node:

```bash
curl -fsSL https://raw.githubusercontent.com/MrBrunoWolff/the-benchmark/main/bench.mjs -o bench.mjs
node bench.mjs
```

There is no git-spec shortcut worth documenting: `bunx` rejects git and
local-tarball specs outright, and `npx github:…` is blocked by default on npm 12
(`allow-git = "none"`).

## Usage

Cloned instead? Load a model in your backend, then:

```bash
bun run bench             # auto-detect the running local server
bun run agentic           # only the agentic coding run
bun run all               # all three phases
node bench.mjs --url http://localhost:8080   # anything else
```

The backend is auto-detected. If only LM Studio or Ollama is running, it is used
automatically. If both are running, the benchmark asks which one to use. For
non-interactive runs with both available, pass `--target lmstudio` or
`--target ollama` explicitly.

To see what the model feels like once a session has history behind it — the
number that actually matters for agent work — sweep the context depth:

```bash
node bench.mjs --depth 0,4096,16384
```

Three phases: **prefill**, **generation**, and **agentic**. The first two run by
default and take under a minute. The agentic phase is opt-in via `--phases`
because it is a real multi-turn agent loop — expect several minutes.

On a **thinking** model, add `--reasoning none` or it will very likely never act
at all:

```bash
node bench.mjs --phases agentic --reasoning none
```

See [The reasoning spiral](#the-reasoning-spiral) for why.

Runs under `bun` or `node` (needs Node 18+ for `fetch` streaming).

The model is auto-detected — on LM Studio it queries `/api/v0/models` and picks
the currently *loaded* one, so it will not accidentally JIT-load a cold model.
Override with `--model`.

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--target` | auto | Force `lmstudio` (1234) or `ollama` (11434); otherwise detect what is running |
| `--url` | — | Explicit base URL; overrides `--target` |
| `--model` | auto | Model id to benchmark |
| `--runs` | `3` | Runs per size; median is reported |
| `--sizes` | `256,2048,8192` | Approx prompt sizes for the prefill test |
| `--gen-tokens` | `256` | `max_tokens` for the generation test |
| `--depth` | `0` | Context depths for the generation test — decode is measured behind a preloaded context of each size, so `0,4096,16384` shows how much the model slows as the KV cache fills |
| `--latency-mode` | `generation` | How the request floor is measured before it is subtracted from prefill: `generation` (a one-token request), `api` (a `/v1/models` fetch), or `none` to skip it and drop the `est_` columns |
| `--phases` | `prefill,generation` | Which phases to run; add `agentic` to include the agent loop |
| `--max-turns` | `12` | Agentic: turn cap before the run is called unconverged |
| `--turn-tokens` | `4096` | Agentic: `max_tokens` per turn — must fit the thinking **and** the tool call |
| `--turn-timeout` | `180` | Agentic: seconds a single turn may take before it is recorded as stalled |
| `--reasoning` | server default | Pass through as `reasoning_effort` (`none`, `low`, `medium`, `high`). `none` is often required to get a thinking model through the agentic phase |
| `--out` | `out` | Agentic: where the generated app and report are written (gitignored) |
| `--json` | off | Also dump raw per-run results as JSON |

## Metrics

Three phases, measured separately, because they are bound by different things:
prefill is compute-bound, generation is memory-bandwidth-bound, and the agentic
loop is bound by whether the model can hold a tool protocol together at all. A
machine — or a model — can win one and lose the others.

### Prompt processing (prefill) — how fast the model *reads*

Sent with `max_tokens=1`, so the request finishes as soon as prefill does.

| Column | Meaning | Better |
| --- | --- | --- |
| `prompt_tok` | Input size in tokens, as counted by the server (not estimated) | — |
| `ttft_ms` | Time to first token. With `max_tokens=1` this is essentially pure prompt-processing time — but it still contains the request round trip | lower |
| `est_ppt_ms` | `ttft_ms` minus the measured request floor, so it approximates what the server alone spent reading the prompt | lower |
| `prefill_tok/s` | `prompt_tok / ttft_ms` — input tokens digested per second, round trip included | higher |
| `est_tok/s` | `prompt_tok / est_ppt_ms` — the same rate with the round trip removed. **Prefer this one** | higher |
| `spread` | Half the observed range across `--runs` repeats, as a percentage of the median. A few percent is noise; tens of percent means one run behaved differently | lower |
| `took_s` / `took_min` | Wall-clock for that row in both seconds and minutes, covering all `--runs` repeats of it | lower |

The floor is measured once per run, after warmup, and printed in the header. It
is a fixed cost on every row: against an 8k prompt it is rounding error, at 256
tokens it is most of the elapsed time. Against a mock server pinned at a true
1,000 tok/s, `prefill_tok/s` reads **851** at 256 tokens while `est_tok/s`
recovers **1,011**.

It is also per-backend and has to be measured rather than assumed — LM Studio's
floor came in at 369ms against Ollama's 255ms on the same machine, which is the
opposite of the obvious guess about which one carries more overhead.

**This corrects the advice in [Reading the results](#reading-the-results).** Small
prompts do not read *inflated* — a fixed per-request cost divided by very few
tokens can only drag a rate down, and every run in [Results](#results) shows the
smallest row lower than the 2k row, not higher. That rising trend is the artefact:
attention cost grows with sequence length, so per-token prefill should get slower
as prompts get longer. With the floor subtracted it does.

### Generation — how fast the model *writes*

Short question, `max_tokens=--gen-tokens`, one row per `--depth`.

| Column | Meaning | Better |
| --- | --- | --- |
| `ctx_tok` | Context actually sent, counted by the server. At `--depth 0` this is just the question; above it, the preloaded context | — |
| `out_tok` | Tokens generated, including any thinking tokens | — |
| `think_tok` | How much of `out_tok` was thinking rather than visible content, when the server reports it. A **subset** of `out_tok`, not an addition to it — which is why it sits next to it | — |
| `ttft_ms` | Time to first token. At depth 0 the prompt is tiny, so this is the request latency floor; at depth it is dominated by reading the preloaded context | lower |
| `gen_tok/s` | `(out_tok - 1) / (total - ttft)` — prefill is excluded, so this is steady-state decode speed. If the response arrives in a single chunk there is no window to measure, so it falls back to `(out_tok - 1) / total` and the run says so | higher |
| `spread` | Half the observed range across `--runs` repeats, as a percentage of the median | lower |
| `peak_tok/s` | The best one-second window, against `gen_tok/s` which is the whole-request average. A large gap means the run was not steady — throttling, memory pressure, or another process competing. Blank when the stream lasted under a second, since there is no window to read | higher |
| `took_s` / `took_min` | Wall-clock for that row in both seconds and minutes | lower |

Not every backend fills `think_tok`. LM Studio returns
`completion_tokens_details.reasoning_tokens` and Ollama does not, so a `0` there
means the server did not say, not that the model did not think.

#### Depth — the number that predicts agentic pain

`gen_tok/s` measured on an empty context is the number everyone quotes, and it is
the one you will never experience. Decode is memory-bandwidth-bound, so every
token has to read the whole KV cache — and in an agent loop that cache is the
entire transcript so far. The agentic phase already prints `ctx_tok` climbing turn
over turn; `--depth` is the same axis measured deliberately, so the two halves of
the benchmark explain each other:

```bash
node bench.mjs --depth 0,4096,16384,32768
```

The falloff is worth measuring rather than assuming: across the two stacks here it
ranged from a few percent to about a third over the same 0→16k span. A tok/s
figure quoted without the depth it was taken at is missing information that is
sometimes negligible and sometimes decisive.

Prefill needs no equivalent flag — `--sizes` already sweeps input length, which is
the same measurement. Measuring prefill "at depth" without a prefix-cache round
trip would just be prefill of a larger prompt.

### Agentic coding — can it actually *drive tools*

Not a completion benchmark. The model is given five tools (`plan`, `write_file`,
`list_files`, `read_file`, `finish`) and asked to build a three-file tip
calculator: plan first, write each file, then call `finish`. The loop runs until
it finishes or hits `--max-turns`.

This measures the things that decide whether a local model is usable as a coding
agent, none of which show up in tok/s:

| Column | Meaning | Better |
| --- | --- | --- |
| `turn` | Which round trip. Each turn is one model message plus the tool result fed back | — |
| `ctx_tok` | Prompt tokens *this* turn — i.e. the whole transcript so far. Watch it grow; this is what makes agent loops expensive | — |
| `first_tok_ms` | Latency before the model starts responding. Rises with `ctx_tok`, because every turn re-prefills the transcript | lower |
| `out_tok` | Tokens the model produced this turn | — |
| `think_tok` | Reasoning tokens inside `out_tok`. If this equals `out_tok` and the action is `no tool call`, the model thought until it ran out of budget — raise `--turn-tokens` | lower |
| `out_tok/s` | Decode speed, as in the generation phase — including its single-chunk fallback, which Ollama's tool calls routinely trigger | higher |
| `took_s` / `took_min` | Wall-clock for that turn, end to end, in both seconds and minutes | lower |
| `action` | The tool call(s) the turn produced, or `no tool call` | — |

And in the summary:

| Field | Meaning |
| --- | --- |
| `finished` | Did it call `finish`, or run into the turn cap? The single most important line |
| `wall_clock_s` / `wall_clock_min` | End-to-end in both seconds and minutes, the number you actually feel |
| `tool_calls` | Total, with a breakdown of **malformed** (arguments were not valid JSON) and **unknown** (invented a tool). Non-zero counts here are the usual reason a local model cannot be an agent |
| `turns_without_a_tool_call` | Turns that produced prose but no action, and how many of those ran out of output budget mid-thought |
| `stalled_turns` | Turns that never returned inside `--turn-timeout`. The run stops at the first one |
| `files_written` | What landed, by name |
| `plan_steps` | Step count, or `never called plan` if it ignored the instruction to plan first |
| `input_tok_total` | Summed `ctx_tok` — the re-prefill tax of the whole conversation |
| `decode_tok_s_median` | Median across turns, so a slow late turn does not hide behind a fast first one |

Files the model writes are held in memory and only flushed to disk at the end,
so a bad path in a tool call cannot touch your working tree.

### The reasoning spiral

The first thing this phase found is worth stating plainly, because it is the
reason `--reasoning` exists.

Given the five tools and this task, `qwen3.8-27b` **never acts**. It reasons
until it runs out of budget, every time:

```
completion_tokens   4095
reasoning_tokens    4095   ← all of it
content_deltas         0
tool_call_deltas       0
finish_reason     length
elapsed             244 s
```

Tokens stream steadily the whole time at 16.8 tok/s — it is not hung, it is
designing the entire app in its head. The reasoning tail is full of finished
decisions (`aria-live="polite"` on the receipt, stepper `aria-label`s, reset
defaults) that never reach a `write_file` call. Raising `--turn-tokens` only buys
a longer spiral; asking it in the system prompt to think less does not work.

Two mitigations, both reported rather than hidden:

- **`--turn-timeout`** (180s) bounds every turn. A turn that blows through it is
  recorded as `STALLED` and the run stops there instead of hanging the benchmark.
  Before this existed, one turn streamed for 16 minutes.
- **`--reasoning none`** turns thinking off via `reasoning_effort`, which is what
  actually gets this model through the loop. Of the three levers tried, only this
  one reaches zero reasoning tokens:

  | Lever | reasoning_tok | Result |
  | --- | --- | --- |
  | `/no_think` in the prompt | 100 | works, but thinking is only reduced |
  | `chat_template_kwargs: {enable_thinking: false}` | 156 | ignored in this build |
  | `reasoning_effort: 'none'` | **0** | thinking off, tool call in 5.8 s |

The spiral is not always fatal, though. On the PC runs below, thinking was left
**on** and the model *did* recover: turn 1 burned the full 4,096-token budget on
4,080 thinking tokens and produced no tool call, then turns 2-6 planned, wrote
three files and called `finish` with barely any thinking at all (16, 9, 9, 34,
13 tokens). The cost was one dead turn — 116.0 s, 57% of that run's entire
agentic wall-clock — rather than the whole run. It came out the same way twice:
**4,080 thinking tokens on turn 1 in both PC runs**, 117.2 s and 116.0 s.

So the failure mode is better described as *the first turn is where it spirals*:
with an empty transcript and an open-ended task it tries to design everything at
once, and once a plan exists in the transcript it stops. Whether it escapes on
its own is luck; `--reasoning none` removes the coin flip.

So the honest headline is that **decode speed was never the bottleneck for
agentic use on this setup** — thinking discipline was. That is exactly the kind
of thing a tok/s benchmark cannot tell you.

Prompt caching is deliberately *not* defeated in this phase, unlike the prefill
test. Real agent loops re-send a growing transcript and benefit from the cache;
suppressing it would measure something nobody experiences.

Token counts come from the server's `usage` block, not from a local tokenizer,
so they are exact. If a backend omits `usage`, output tokens fall back to a
stream-chunk count and the run is labelled approximate.

## Proposed clearer CLI column names

Two of the original headers were actively misleading: `ttft_ms` meant a different
thing in each section, and `reasoning_tok` sat at the far right where nothing
suggested it was a slice of `out_tok`.

**Already shipped**, because they cost nothing to get right:

- the `runtime` header line — quant, backend and loaded context length are what
  make two runs comparable, and both machines below needed a manual
  `/api/v0/models` call to recover them after the fact. **LM Studio only**: on
  Ollama the line is absent, and recovering the equivalent took a manual
  `/api/show` plus `/api/ps` — which is exactly how the two glimmer runs turned out
  to be different 4-bit builds. Fetching those two endpoints is the obvious next
  thing to ship
- `think_tok` in the agentic **and** generation tables, sitting immediately next
  to `out_tok` so the subset relationship is visible. The generation table's shape
  changed anyway when `--depth` landed, so the rename cost nothing extra there
- `took_s` / `took_min` on every row, and a `TIME TAKEN` block per phase
- the HTML report, which carries the full human-readable name, the unit and an
  explainer for every metric — so the terse keys below only have to serve people
  already looking at a terminal

- `ctx_tok` in the generation table, matching the agentic one, now that `--depth`
  gives that phase a context worth naming
- `est_ppt_ms` / `est_tok/s`, which sidestep the `ttft_ms` ambiguity in the prefill
  phase entirely by reporting the quantity people actually wanted from it

**Still proposed** for the rest, since the agentic table already uses
`ctx_tok` / `first_tok_ms` / `out_tok/s` and the two halves of the output should
not disagree:

```
PROMPT PROCESSING — reading the input (max_tokens=1, unique prompt per run)
  input_tok    prefill_ms    input_tok/s       took_s (took_min)
       8253       18515.7          445.7        55.5s (0.93m)

GENERATION — writing the output (max_tokens=256, short prompt)
  out_tok   think_tok   first_tok_ms   out_tok/s       took_s (took_min)
      255         255          681.5       17.56        44.8s (0.75m)
```

| Now | Proposed | Why |
| --- | --- | --- |
| `prompt_tok` | `input_tok` | Pairs with `out_tok`; "prompt" also names the flag that sets it |
| `ttft_ms` (prefill) | `prefill_ms` | In that section it *is* the prefill time — say so instead of making the reader derive it |
| `prefill_tok/s` | `input_tok/s` | Names the thing being counted, and matches the column it derives from |
| `ttft_ms` (generation) | `first_tok_ms` | Same quantity, different meaning here — it is the latency floor, so stop reusing the prefill name |
| `gen_tok/s` | `out_tok/s` | Consistent with `out_tok`, and with the agentic table |

Renaming these is a breaking change for anyone parsing the output, which is why
they are listed rather than applied.

## Time taken

Every phase reports its own wall-clock, and every row reports the time for that
row in both seconds and minutes, so a good rate inside a slow phase is obvious
rather than buried:

```
TIME TAKEN
  Prompt processing  91.4s (1.52m)
  Generation         44.8s (0.75m)
  Agentic coding    135.1s (2.25m)
  Whole run         272.6s (4.54m)
```

`took_s` / `took_min` on a prefill row covers all `--runs` repeats of that size;
on an agentic turn it is that single turn end to end. The warmup request is
excluded from all of it. JSON keeps seconds as its canonical numeric value.

## The HTML report

Every run writes `out/run-<timestamp>/report.html` (gitignored) — the same
numbers as the terminal, but with the things a terse column header cannot carry:

- **Human-readable names alongside the keys.** Each column is headed
  *Time to first token* with `ttft_ms · TTFT` beneath it, so the report is
  readable by someone who has never seen the CLI.
- **A per-metric glossary under each table** — what the number measures, its
  unit, and whether higher or lower is better.
- **Per-field explanations of the agentic summary**, including why `finished` is
  the line that matters most.
- **A time-taken table** with each phase's share of the whole run.
- **A live `<iframe>` of the app the model built**, next to every generated file
  in a foldable block.

When the agentic phase ran, the app itself is written alongside it:

```
out/run-2026-08-18T15-35-16/
├── report.html
└── app/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Reading the results

- **On small prompts read `est_tok/s`, not `prefill_tok/s`.** At a few hundred
  tokens the request round trip is most of the elapsed time, which drags the raw
  rate *down* — earlier versions of this README said inflated, which was backwards.
  The floor is now measured and subtracted; the raw column is kept only so older
  runs stay comparable.
- **Medians, not means, for a reason.** Backends cache prompts. A single cached
  run can report an order-of-magnitude-too-high prefill rate; the median rejects
  it — and `spread` tells you it happened, which a mean would have quietly
  absorbed. Keep `--runs` at 3 or more, and inspect `--json` when `spread` is
  large. Prompt caching is *mostly* defeated (see below) but not perfectly.
- **`gen_tok/s` at depth 0 is the number you will never experience.** Run
  `--depth` before believing any single decode figure.
- **A `peak_tok/s` far above `gen_tok/s` means the run was not steady.** On a
  laptop that is usually thermal throttling, and it is exactly the case a lone
  median hides.
- **Thinking models** may spend the entire budget on reasoning tokens.
  `gen_tok/s` is still correct — tokens are tokens — but raise `--gen-tokens` if
  you want visible content too.

## Design notes

- **Prompt caching is defeated on purpose in the prefill phase.** Backends cache
  prompt prefixes, which would turn the prefill test into a cache-hit test. Every
  run prefixes a unique nonce *first*, so no prefix is ever shared. The nonce is
  seeded per **process**, not just per run — an in-run counter restarts at zero
  every invocation, so back-to-back runs would send byte-identical prompts and be
  served from the backend's *on-disk* cache. That mistake reported 4,898 tok/s at
  2k against a true ~460. Effective now, but still not airtight, hence the median.
- **A warmup run precedes measurement** so JIT model loading is not counted in
  the first result.
- **The request floor is measured, not assumed.** Every timing includes the cost
  of getting a request out and a first byte back. One measurement after warmup
  (`--latency-mode`) turns the smallest prefill row from an artefact into a
  number, and it is printed in the header so you can see what was subtracted.
- **Depth is a generation-phase knob only,** and it goes in a system message so
  the question itself stays the same length across rows — what changes between
  them is the KV cache, not the thing being asked.
- **`temperature: 0`** for run-to-run stability.
- **Cold-load time is not measured** — that needs an unload between runs, which
  has no portable API across backends. Restart the backend and watch the warmup
  if you care about it.
- **The Ollama path has now been verified on live Ollama servers on both
  machines**, and it holds the same OpenAI-compatible contract:
  `stream_options: {include_usage: true}`
  returns an exact `usage` block, so the fallback to counting stream chunks never
  triggered. It did expose two timing bugs — Ollama names its thinking delta
  `reasoning`, not `reasoning_content`, and ships the whole tool call in one final
  SSE chunk — both now fixed; see [what the first run broke](#what-the-first-run-broke).
- **The agentic phase is opt-in** because it costs far more wall-clock than the
  other two: worst case is `--max-turns × --turn-timeout`. Keeping it off
  `bun run bench` means the quick numbers stay quick.
- **Every turn has a deadline.** A model that reasons without converging would
  otherwise hang the run indefinitely — one turn here streamed for 16 minutes
  before the deadline existed. `--turn-timeout` bounds it, and the stall is
  reported as a result rather than swallowed.
- **Generated files never touch the working tree.** They live in a `Map` for the
  duration of the run and are flushed to `out/` at the end, with path traversal
  rejected twice — once when the tool call is handled, once before the write.
- **The agentic phase does not grade the app.** It reports whether the model
  converged, whether its tool calls were well-formed, and what it produced; the
  `report.html` iframe is there so *you* judge the output. Scoring correctness
  would mean baking in a rubric, which stops being a server benchmark.
- **Tool results are fed back as real `role: "tool"` messages**, so the
  transcript grows exactly as it would in a real agent — which is the point of
  watching `ctx_tok`.
- **Run metadata is thinner on Ollama than on LM Studio.** No quantisation, no
  loaded context length, and no `reasoning_tokens`, so `think_tok` prints 0 on a
  model that is demonstrably thinking. The first two are recoverable from
  `/api/show` and `/api/ps` and are not fetched yet; the third the backend does not
  report.
- **The 8k prefill row is not silently truncated on Ollama**, which is worth
  checking because many builds default `num_ctx` far below it. Two independent
  confirmations: under these defaults `/api/ps` reports the model loaded at its
  full 131,072 context, and `prompt_tokens` — which Ollama fills from
  `prompt_eval_count`, the tokens it actually evaluated — came back as the full
  8,264. A truncating server would have reported the truncated count and an
  inflated rate.

## Results

Four full runs, all post-cache-fix, all against the current code, all with all
three phases. They form a **2×2**: two machines — a 48 GB M5 Pro Mac and a
7900 XT PC — each running two stacks, `qwen/qwen3.8-27b` on **LM Studio** and
`muse-glimmer:30b` on **Ollama**.

That grid is what makes the numbers worth reading. Holding the stack and swapping
the machine isolates hardware; holding the machine and swapping the stack isolates
model-plus-backend. The single most useful result falls straight out of it:
**throughput tracks the machine, convergence tracks the model** — see
[the 2x2](#the-2x2--two-machines-two-stacks).

Caveats that apply throughout: the qwen runs differ in one benchmark setting (the
Mac ran `--reasoning none`, the PC ran with thinking on, which matters only for the
agentic phase), and the two glimmer runs share a tag but not a build — 4-bit both
times, `nvfp4` under MLX on the Mac against `Q4_K_M` GGUF on the PC. The benchmark
does not print that for Ollama; it was recovered from `/api/show`.

The Mac's glimmer run is also the one that finally exercised the Ollama path, and
its first attempt caught the benchmark mistiming that backend badly enough to
report decode speeds in the millions. The numbers published are from a clean
re-run against the fixed instrument; the broken ones are kept as evidence in
[what the first run broke](#what-the-first-run-broke).

### MacBook Pro · Apple M5 Pro · qwen on LM Studio

18-core CPU (6 Super + 12 Performance) · 20-core GPU · 48 GB unified memory ·
macOS 26.6.1 · LM Studio on MLX (Metal) · `qwen/qwen3.8-27b` 4-bit @ 119,552 ctx ·
`--reasoning none`

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)
         284      850.5            333.9                2.6s (0.04m)
        2077     4530.6            458.4               13.6s (0.23m)
        8221    19844.9            414.3               59.3s (0.99m)
  total 75.5s (1.26m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)
      255      508.5        17.13               0               46.0s (0.77m)
  total 46.0s (0.77m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        784          4290.3         84            0        18.95                8.7s (0.14m)   plan(4 steps)
     2        896          1114.0        608            0        16.71               37.4s (0.62m)   write_file(index.html, 1.8 KB)
     3       1532          1065.5        849            0        16.61               52.1s (0.87m)   write_file(styles.css, 1.8 KB)
     4       2409          1079.7        428            0        16.80               26.5s (0.44m)   write_file(app.js, 1.5 KB)
     5       2865          1017.3        155            0        17.49                9.8s (0.16m)   finish

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               134.6
    wall_clock_min             2.24
    turns_used                 5 / 12
    tool_calls                 5 (0 malformed, 0 unknown)
    turns_without_a_tool_call  0
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 4
    input_tok_total            8,486
    output_tok_total           2,124
    thinking_tok_total         0
    decode_tok_s_median        16.80

TIME TAKEN
  Prompt processing  75.5s (1.26m)
  Generation         46.0s (0.77m)
  Agentic coding    134.6s (2.24m)
  Whole run         257.6s (4.29m)
```

Prefill reads **414.3 tok/s at 8k**, which is the figure to trust; the 2k row sits
higher at 458.4 and the 284-token row lower at 333.9. Generation holds
**~17 tok/s**.

> An earlier hand-run on this machine reported 470 and 446 tok/s at 2k and 8k.
> Those were taken before the cross-process cache fix described in the design
> notes, so they were partly served from the on-disk prompt cache. The ~414
> figure above is the honest one.

The 284-token row reads *lower* than the larger sizes, as it does on the PC
below now that the cache fix has landed there too: ~850 ms of fixed per-request
overhead simply outweighs 284 tokens of work. Further evidence the row carries no
signal.

The 2k row is also the least stable number in this README: it moved 403.8 → 458.4
between two runs of the same model on the same machine, **+13.5%**, while 8k moved
+1.9%. Same evidence, from the other direction, that the small sizes measure
overhead rather than throughput.

#### The agentic run

With thinking off it is a clean run: **5 turns, 5 tool calls, zero malformed,
zero wasted turns** — the minimum possible path through the task — producing a
working three-file app in 134.6 s.

- **Tool-call discipline is perfect once it stops thinking.** No malformed JSON,
  no invented tools, no prose-instead-of-action turns. The protocol was never the
  weak spot; the reasoning budget was.
- **`ctx_tok` nearly quadruples** across five turns (784 → 2,865) purely from
  feeding results back. `input_tok_total` of 8,486 against 2,124 output tokens is
  the re-prefill tax: this loop spent **4× more tokens re-reading its own
  transcript than producing anything**. That ratio, not tok/s, is what makes long
  agent sessions expensive.
- **`first_tok_ms` flattens at ~1,050 ms** from turn 2 on, even as `ctx_tok`
  grows, because prompt caching is left enabled here and each turn only
  re-prefills the new suffix. Turn 1 pays 4,290 ms against a transcript the cache
  has never seen — the one turn where the caching is not yet helping.
- **Decode holds ~16.8 tok/s**, matching the generation phase, so the agent loop
  costs nothing in throughput beyond the extra context.
- **`took_s` is dominated by output length, not context.** The two 1.8 KB files
  cost 37 s and 52 s; `finish` cost 10 s. At ~17 tok/s, writing files *is* the
  wall-clock.

The app it produced is genuinely usable — labelled inputs, `aria-live="polite"`
on the results region, live recalculation on `input`, values clamped, no CDNs.

Unlike the glimmer run, it is **not reproducible byte for byte**: re-running this
exact configuration at `temperature: 0` produced a working app of a different
size (5.2 KB against 5.3 KB) with the same five turns and the same file set. Two
identical-looking runs of the same model on the same machine still differ, which
is worth remembering before reading much into a single `took_s`.

### Desktop · Ryzen 7 5800X3D + Radeon RX 7900 XT · qwen on LM Studio

Radeon RX 7900 XT 20 GB · 31 GB RAM · LM Studio on Vulkan ·
`qwen/qwen3.8-27b` Q4_K_M GGUF @ 128,000 ctx · thinking left **on** (no
`--reasoning` flag) · GPU offload not recorded by the benchmark

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)
         327      970.0            337.1                2.9s (0.05m)
        2120     4504.6            470.6               13.3s (0.22m)
        8264    16742.9            493.6               50.1s (0.84m)
  total 66.4s (1.11m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)
      256      658.9        35.63             256               23.8s (0.40m)
  total 23.8s (0.40m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        820          2081.9       4096         4080        35.93              116.0s (1.93m)   no tool call (hit the 4096-token cap)
     2        854           770.2         93           16        35.19                3.4s (0.06m)   plan(4 steps)
     3        957           505.6        914            9        42.00               22.2s (0.37m)   write_file(index.html, 2.9 KB)
     4       1888         1985.7        1412            9        40.38               36.9s (0.62m)   write_file(styles.css, 3.2 KB)
     5       3317         2989.3         599           34        37.71               18.8s (0.31m)   write_file(app.js, 2.0 KB)
     6       3908         1501.3         166           13        32.81                6.5s (0.11m)   finish

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               204.0
    wall_clock_min             3.40
    turns_used                 6 / 12
    tool_calls                 5 (0 malformed, 0 unknown)
    turns_without_a_tool_call  1 — 1 of them ran out of output budget mid-thought
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 4
    input_tok_total            11,744
    output_tok_total           7,280
    thinking_tok_total         4,161
    decode_tok_s_median        36.82

TIME TAKEN
  Prompt processing  66.4s (1.11m)
  Generation         23.8s (0.40m)
  Agentic coding     204.0s (3.40m)
  Whole run          295.0s (4.92m)
```

Prefill settles at **493.6 tok/s** at 8k, generation at **35.63 tok/s**.

The 327-token row reads **337 tok/s** — *below* the larger sizes, matching the
Mac's shape. The oldest run on this machine reported 905 tok/s on that same row,
which was the on-disk prompt cache, not the GPU. The latency-floor artefact is
real but it depresses the small row; it does not double it.

**This machine is the reproducibility control for the whole README**, because it
has now run the identical configuration twice, either side of the Ollama timing
fixes:

| | first run | re-run | Δ |
| --- | --- | --- | --- |
| prefill @ 8k | 493.1 tok/s | 493.6 tok/s | +0.1% |
| prefill @ 2k | 472.2 tok/s | 470.6 tok/s | −0.3% |
| generation | 35.24 tok/s | 35.63 tok/s | +1.1% |
| agentic wall-clock | 211.1 s | 204.0 s | −3.4% |
| decode median (agentic) | 36.69 tok/s | 36.82 tok/s | +0.4% |
| spiral turn 1 | 4,080 think / 117.2 s | 4,080 think / 116.0 s | −1.0% |

Every rate lands inside ±1.1%, and turn 1 spiralled to **the same 4,080 thinking
tokens** both times. That is two things at once: the timing fixes are a verified
no-op on LM Studio, and the spread on these numbers is small enough that the gaps
reported elsewhere in this README — 19%, 58%, 2.2× — are signal.

What is *not* reproducible is the app: 8.7 KB the first time, 8.4 KB the second,
different bytes in all three files at `temperature: 0`. Rates repeat; output does
not.

> Both runs supersede an earlier partial one on this machine (452.6 / 463.3 tok/s
> prefill, 12.96 tok/s generation, `n_gpu_layers=56`, 80,384 ctx, agentic not
> run). Those prefill figures predated the cross-process cache fix, and decode
> was measured under partial CPU offload.

#### The agentic run

It converged — **6 turns, 5 tool calls, zero malformed, zero unknown tools** —
but it paid a turn for it, and that turn dominates the run:

- **Turn 1 produced nothing.** 4,096 output tokens, 4,080 of them thinking,
  `finish_reason: length`, no tool call. That is the reasoning spiral, and at
  116.0 s it is **57% of the 204.0 s agentic wall-clock**. Turns 2-6 then used
  3,184 output tokens and 81 thinking tokens total to do the entire task.
- **Faster decode, slower run.** Decode is 36.82 tok/s median here against the
  Mac's 16.80 — 2.2× faster — yet the agentic phase took 204.0 s versus the Mac's
  134.6 s. One wasted thinking turn more than ate a doubling of throughput. This
  is the clearest single argument in the whole benchmark for why tok/s is not the
  number that matters for agent work.
- **Thinking inflates output, not context.** `output_tok_total` is 7,280 against
  the Mac's 2,124, almost entirely the 4,161 thinking tokens. The
  re-prefill ratio therefore looks *better* here (11,744 in / 7,280 out = 1.6×
  versus the Mac's 4.0×) — an artefact of wasted output, not of a cheaper loop.
- **`first_tok_ms` is noisier than the Mac's** (506 ms to 2,989 ms, not tracking
  `ctx_tok` monotonically). Caching is clearly working: at ~494 tok/s an uncached
  3,908-token prefill would cost ~8 s, and turn 6 started in 1.5 s.
- **It writes more.** 8.1 KB across three files versus the Mac's 5.2 KB, with the
  same 4-step plan and the same file set — the thinking-on run is simply more
  verbose.

### Side by side — the two qwen runs

| | M5 Pro (MLX) | 7900 XT (Vulkan) |
| --- | --- | --- |
| prefill @ 2k | 458.4 tok/s | **470.6 tok/s** |
| prefill @ 8k | 414.3 tok/s | **493.6 tok/s** |
| ttft @ 8k | 19.8 s | **16.7 s** |
| generation | 17.13 tok/s | **35.63 tok/s** |
| agentic, converged | yes — 5 turns / 134.6 s | yes — 6 turns / 204.0 s |
| wasted turns | 0 | 1 (the spiral, 116.0 s) |
| decode, agentic median | 16.80 tok/s | **36.82 tok/s** |
| `--reasoning` | `none` | server default (on) |

Both machines are post-cache-fix and post-timing-fix, so the comparison holds.

**The PC wins every raw-speed row.** Prefill is ~19% faster at 8k and decode is
**2.1× faster** — the reverse of the oldest, partly-cached and partly-offloaded
numbers, which had the Mac ahead on generation. Decode nearly tripling (12.96 →
35.63 tok/s) on the same GPU and quant is far too large to be run-to-run noise,
and the likeliest cause is that the layers no longer spill to the CPU. The
benchmark's `runtime` header only records backend, quant and context length, not
`n_gpu_layers`, so that remains an inference rather than a measurement.

**The Mac wins the only row a user feels.** It finished the agentic task in 134.6 s
to the PC's 204.0 s, at half the decode speed, because it never spent a turn
thinking. Run the PC with `--reasoning none` and it should finish the same five
turns at ~2× the Mac's rate; that is the run still missing.

Remaining caveats: different quantisations (MLX 4-bit versus GGUF Q4_K_M) and
slightly different loaded context lengths (119,552 on the Mac, 128,000 on the PC —
too small a gap to move a rate). The reasoning spiral is a model property, not a
hardware one; it reproduced on both machines and on both PC runs, down to the same
4,080 thinking tokens, and the only reason the PC escaped it is that turn 1's dead
end left a usable transcript behind.

### MacBook Pro · muse-glimmer 30B on Ollama

Same Mac as above, different everything else: different model, different backend,
different quantisation. This is the first run against a **live Ollama server**, so
it retires the "unverified" caveat in the design notes — and the first attempt at
it caught the benchmark mistiming that backend badly enough to report decode
speeds in the millions. That is written up in [what the first run
broke](#what-the-first-run-broke); the table here is a clean re-run against the
fixed instrument.

18-core CPU (6 Super + 12 Performance) · 20-core GPU · 48 GB unified memory ·
macOS 26.6.1 · Ollama on `localhost:11434` · `muse-glimmer:30b-mlx` — 32.3B params,
`nvfp4`, 131,072 ctx per `/api/show` · thinking left **on** (no `--reasoning` flag)

Same model and the same 4-bit class as the PC's run below, but a different build:
`nvfp4` under MLX here, `Q4_K_M` GGUF there. The reported parameter counts differ
too — 32.3B here against 27.9B there — which is a metadata-reporting difference
between the MLX and GGUF packagings rather than two different models.

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)
         329      789.6            416.7                2.4s (0.04m)
        2122     4405.9            481.6               13.3s (0.22m)
        8266    18670.8            442.7               56.1s (0.94m)
  total 71.8s (1.20m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)
      256      438.2        33.82               0               23.7s (0.40m)
  total 23.7s (0.40m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        888          2180.4        302            0        29.92               12.2s (0.20m)   plan(5 steps)
     2       1037           698.0        479            0        34.09               14.7s (0.25m)   write_file(index.html, 1.3 KB)
     3       1529         18433.5        533            0        28.86               18.4s (0.31m)   write_file(styles.css, 1.3 KB)
     4       2092         17223.1        545            0        31.59               17.2s (0.29m)   write_file(app.js, 1.7 KB)
     5       2667          1338.4         28            0        20.17                1.3s (0.02m)   list_files(3)
     6       2725          4692.7        103            0        21.74                4.7s (0.08m)   finish
  note: 4 turns arrived in one chunk; on those rows first_tok_ms is the whole turn and out_tok/s is end-to-end, not steady-state decode

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               68.6
    wall_clock_min             1.14
    turns_used                 6 / 12
    tool_calls                 6 (0 malformed, 0 unknown)
    turns_without_a_tool_call  0
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 5
    input_tok_total            10,938
    output_tok_total           1,990
    thinking_tok_total         0
    decode_tok_s_median        29.39

TIME TAKEN
  Prompt processing  71.8s (1.20m)
  Generation         23.7s (0.40m)
  Agentic coding     68.6s (1.14m)
  Whole run          171.2s (2.85m)
```

Prefill settles at **~443 tok/s** at 8k. The 2k row reads higher at 481.6 and the
329-token row lower at 416.7 — the same latency-floor shape both other runs show,
which is why the largest size is the one to trust. Generation runs at
**33.82 tok/s**.

`think_tok` reads 0 on every row and it is **not** true. Ollama omits
`reasoning_tokens` from its `usage` block entirely, so the benchmark has nothing
to report; the model demonstrably thinks — turns 1 and 2 stream thinking deltas
for hundreds of milliseconds before anything else arrives. This is the one column
the fix could not recover.

#### The agentic run

**68.6 s, 6 turns, 6 tool calls, zero malformed, zero unknown, zero wasted
turns** — with thinking left *on*. It is the fastest agentic run in this README:
about half the Mac's qwen run (134.6 s), a third of the PC's qwen run (204.0 s),
and 21% quicker than the same model on the PC (86.9 s).

- **It converged with thinking on and wasted nothing doing it.** No spiral, no
  dead first turn, no `--reasoning none` needed. The PC's qwen run also converged
  with thinking on, but only after burning turn 1 — 116.0 s — on the spiral. That
  difference is a model property, not a hardware one: the same Mac produced the
  spiral under qwen, and glimmer avoided it on the PC too.
- **It took one extra turn on purpose.** Turn 5 is a `list_files` call: it
  verified the three files existed before calling `finish`. Only the glimmer runs
  checked their own work, on both machines, and it cost 1.3 s.
- **It writes tighter.** 4.4 KB across three files against the Mac-qwen run's
  5.2 KB, the PC-qwen run's 8.1 KB and its own PC run's 5.6 KB, from 1,990 output
  tokens — the fewest of the four, despite a 5-step plan rather than 4.
- **The re-prefill tax is the worst of the four.** 10,938 input against 1,990
  output is **5.5×**, versus 4.8× for glimmer on the PC, the Mac-qwen run's 4.0×
  and the PC-qwen run's 1.6×. Short
  turns make the ratio worse, not better: every turn still re-reads the whole
  transcript, so a loop that produces less per turn pays proportionally more.
- **Only two of six turns have a measurable decode rate.** Turns 1 and 2 stream
  thinking, so `first_tok_ms` is real there. Turns 3 to 6 emit no reasoning at
  all — the model has its plan and just writes — and Ollama ships the whole tool
  call in one chunk, so those rows fall back to an end-to-end rate. The note
  under the table says which.

The app is genuinely good — `<label>` on every input, `aria-live="polite"` and
`aria-atomic` on the results region, `Intl.NumberFormat` currency, validation
that degrades to `$0.00` rather than `NaN`, no CDNs. At `temperature: 0` it came
out **byte-identical** across both runs of this section, which is what makes the
before/after below a comparison of the instrument rather than of the model.

#### What the first run broke

The first glimmer run printed this:

```
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        888         11853.9        302            0   3742989.67               11.9s (0.20m)   plan(5 steps)
     2       1037         14215.8        479            0   4972691.81               14.2s (0.24m)   write_file(index.html, 1.3 KB)
     3       1529         17658.6        533            0  11259259.26               17.7s (0.29m)   write_file(styles.css, 1.3 KB)
     4       2092         16142.4        545            0   8079127.93               16.1s (0.27m)   write_file(app.js, 1.7 KB)
     5       2667          1285.4         28            0    604486.63                1.3s (0.02m)   list_files(3)
     6       2725          4320.1        104            0   2286805.35                4.3s (0.07m)   finish

    decode_tok_s_median        4357840.74
```

Four columns were wrong, and 3.7 million tokens per second is the giveaway. The
cause is how Ollama streams, verified directly against the server:

- **Ollama ships the entire tool call in one final SSE chunk.** In a 23.1 s probe
  request, the `tool_calls` delta arrived at 23.14 s — event 150 of 152.
  Everything before it was `reasoning` deltas.
- **The benchmark only marked TTFT on `delta.content`, `delta.reasoning_content`
  or `delta.tool_calls`.** Ollama names its thinking delta `reasoning`, not
  `reasoning_content`, so nothing marked TTFT until that final chunk landed.

So on every tool-calling turn `first_tok_ms` collapsed onto the turn's own
wall-clock — 11853.9 ms against 11.9 s, 14215.8 against 14.2 s, all six rows —
and `out_tok/s`, which is `(out_tok - 1) / (total - ttft)`, divided by ~0.

| Column | Pre-fix | Read it as |
| --- | --- | --- |
| `first_tok_ms` (agentic) | ✗ | Whole-turn latency, not time to first token |
| `out_tok/s` (agentic) | ✗ | Meaningless — `decode_tok_s_median` too |
| `ttft_ms` (generation) | ✗ | The whole request. This model spent all 256 tokens on reasoning, emitting no visible content, so nothing ever marked TTFT |
| `think_tok` / `thinking_tok_total` | ✗ | Always 0 — and still is; Ollama omits `reasoning_tokens` from `usage` |
| `gen_tok/s` | ✓ | The `ttft ?? 0` fallback made it `(out_tok - 1) / total`, an honest end-to-end rate |
| `prefill_tok/s` | ✓ | `max_tokens=1`, so `ttft ≈ total ≈ prefill` by construction |
| everything counted (`ctx_tok`, `out_tok`, `input_tok_total`) | ✓ | Exact — `stream_options: {include_usage: true}` gets a real `usage` block |
| convergence (`finished`, `tool_calls`, `files_written`, `wall_clock_s`) | ✓ | Exact, and the headline of this phase anyway |

Two fixes, both in `bench.mjs`:

- **TTFT marks on `delta.reasoning` too**, not just `delta.reasoning_content`.
  Thinking deltas are the model producing tokens, so they start the clock.
- **`genTps` no longer divides by a zero window.** When the whole response
  arrives in one chunk there is no steady state to measure, so it falls back to
  the end-to-end rate `(out_tok - 1) / total` and the run prints a note naming
  the rows that applies to.

**The fix is Ollama-specific, and that was checked rather than assumed.** LM
Studio sends `reasoning_content` — the spelling the benchmark already handled —
and reports `reasoning_tokens` in its `usage` block, so nothing here changes on
that backend. Both LM Studio machines were re-run after the fix and both
reproduced inside noise — the Mac 134.9 → 134.6 s agentic and 17.18 → 16.80 tok/s
median decode, the PC 211.1 → 204.0 s and 36.69 → 36.82 tok/s — and no run against
LM Studio has ever printed the single-chunk note. Meanwhile the PC's glimmer run
printed it on 4 of 6 turns, exactly as the Mac's did, which confirms the
single-chunk behaviour belongs to Ollama rather than to either machine.

What changed on Ollama, on byte-identical output:

| | Pre-fix | Post-fix |
| --- | --- | --- |
| `decode_tok_s_median` | 4,357,840.74 | **29.39** |
| `out_tok/s` range | 604,486 – 11,259,259 | **20.17 – 34.09** |
| `first_tok_ms`, turns 1-2 | 11853.9 / 14215.8 | **2180.4 / 698.0** |
| `ttft_ms` (generation) | 7298.5 | **438.2** |
| `gen_tok/s` | 34.94 | 33.82 |

`decode_tok_s_median` at 29.39 sits right on the 27.8 that recomputing the
pre-fix table by hand — `out_tok / took_s` per turn — had already suggested,
which is the confirmation that mattered.

**`gen_tok/s` barely moved, and that is expected.** The pre-fix value was already
an end-to-end rate over a request that was ~94% decode, so excluding a 438 ms
TTFT can only lift it a few percent; run-to-run variance is the same size. The
column that was badly wrong was never that one.

Two further findings from the same probing, both correcting things this README
previously assumed:

- **Ollama honours `reasoning_effort`.** `none` took a 95-reasoning-delta
  response to zero. So `--reasoning none` is a live lever here too — these runs
  simply did not use it.
- **Ollama returns an exact `usage` block** when asked via `stream_options`, so
  the "falls back to counting stream chunks" caveat never triggered.

### Desktop · muse-glimmer 30B on Ollama

The fourth cell of the grid: the PC's GPU under the Mac's stack. Same Ollama tag,
same task, same flags — the only thing that changed from the run above it is the
machine.

Radeon RX 7900 XT 20 GB · 31 GB RAM · Ollama 0.32.14 on `localhost:11434` ·
`muse-glimmer:30b` — 27.9B params, **Q4_K_M GGUF**, 131,072 ctx loaded, 16.7 GB
resident and **100% in VRAM** (`size_vram` equals `size` in `/api/ps`) · 52 blocks,
32 heads / 2 KV heads, 6,656 embedding · thinking left **on** (no `--reasoning`
flag)

Those figures come from `/api/show` and `/api/ps`, not from the benchmark — Ollama
prints no `runtime` header line, which is still the gap to close.

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)
         327      741.9            440.8                2.2s (0.04m)
        2120     2833.9            748.1                8.5s (0.14m)
        8264    10609.1            779.0               31.8s (0.53m)
  total 42.5s (0.71m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)
      256      680.6        32.27               0               25.9s (0.43m)
  total 25.9s (0.43m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        888          1462.0        457            0        31.72               15.8s (0.26m)   plan(4 steps)
     2       1067           736.0        511            0        31.55               16.9s (0.28m)   write_file(index.html, 1.5 KB)
     3       1590         29741.5        890            0        29.89               29.7s (0.50m)   write_file(styles.css, 2.4 KB)
     4       2509         17887.9        533            0        29.74               17.9s (0.30m)   write_file(app.js, 1.7 KB)
     5       3071          1430.8         29            0        19.57                1.4s (0.02m)   list_files(3)
     6       3129          5057.6        139            0        27.28                5.1s (0.08m)   finish
  note: 4 turns arrived in one chunk; on those rows first_tok_ms is the whole turn and out_tok/s is end-to-end, not steady-state decode

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               86.9
    wall_clock_min             1.45
    turns_used                 6 / 12
    tool_calls                 6 (0 malformed, 0 unknown)
    turns_without_a_tool_call  0
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 4
    input_tok_total            12,254
    output_tok_total           2,559
    thinking_tok_total         0
    decode_tok_s_median        29.82

TIME TAKEN
  Prompt processing  42.5s (0.71m)
  Generation         25.9s (0.43m)
  Agentic coding     86.9s (1.45m)
  Whole run          177.6s (2.96m)
```

**Prefill is 779.0 tok/s at 8k — the fastest number in this README by 58%.** The
same GPU under LM Studio's Vulkan runtime reads 493.6. The 2k row agrees closely
at 748.1 — 4.1% apart, the tightest 2k/8k agreement of any run here, against 4.9%,
8.8% and 10.6% for the others — and the whole prefill phase finished in 42.5 s
against the PC's own 66.4 s under LM Studio.

Two variables moved at once — model and backend — so this is not attributable to
either alone. What it does rule out is the GPU: the 7900 XT is capable of ~780
tok/s of prefill, and the 493.6 measured on it under LM Studio is a property of
that stack, not a ceiling of the hardware.

Generation reads **32.27 tok/s**, and this is the surprise: it is *slower* than the
same model on the Mac (33.82), the only row in the entire 2×2 where the PC loses.
Held next to qwen doubling on this machine (17.13 → 35.63), it says glimmer's
decode rate barely depends on which of these two machines runs it.

`think_tok` reads 0 on every row and it is **not** true, exactly as on the Mac:
Ollama omits `reasoning_tokens` from its `usage` block, so the benchmark has
nothing to report.

#### The agentic run

**86.9 s, 6 turns, 6 tool calls, zero malformed, zero unknown, zero wasted turns**
— with thinking left *on*. On this machine that is **2.3× faster than qwen's
204.0 s**, from a stack whose agentic decode median is 19% *lower* (29.82 against
36.82 tok/s).

- **The model's behaviour crossed machines intact.** Turn 5 is a `list_files`
  call — it verified the three files existed before calling `finish`, the same
  self-check the Mac's glimmer run made, at the same trivial cost (1.4 s). It is
  the only tool call anywhere in this README that verifies rather than produces,
  and both glimmer runs make it. Six turns, six tool calls, no spiral, both times.
- **The wall-clock gap to the Mac is entirely output volume.** 2,559 output tokens
  at 29.82 tok/s predicts 85.8 s; the run took 86.9 s. The Mac's 1,990 tokens at
  29.39 predicts 67.7 s against an actual 68.6 s. Both are within ~1.5%, so
  nothing else — not context growth, not tool overhead — is meaningfully in play:
  **agentic wall-clock here is output tokens divided by decode rate.**
- **It wrote 27% more than the Mac did.** 5.6 KB across three files against
  4.4 KB, and a 4-step plan against the Mac's 5. Same tag, same `temperature: 0`,
  and *not* byte-identical the way the two Mac runs were — which the metadata now
  explains: this is **Q4_K_M GGUF** and the Mac's is **nvfp4 under MLX**. Both are
  4-bit, but they are not the same weights bit-for-bit, so identical output was
  never on the table.
- **The re-prefill tax is 4.8×.** 12,254 input against 2,559 output — the highest
  `input_tok_total` of all four runs, off barely a third of the PC-qwen run's
  output. Short productive turns make that ratio worse, not better.
- **`first_tok_ms` is unreadable on 4 of 6 rows**, and the note under the table
  says which. Turns 3 and 4 show 29.7 s and 17.9 s — those are whole-turn
  wall-clocks, not latencies, because Ollama shipped each tool call in a single
  final chunk. Turns 1, 2 and 5 stream normally and read 1.5 s, 0.7 s and 1.4 s.

The app has the same signature as the Mac's: `<label>` on all three inputs,
`aria-live="polite"` with `aria-atomic` on the results region,
`Intl.NumberFormat` currency, no CDNs — plus a `keydown` handler the Mac's build
did not have.

### The 2x2 — two machines, two stacks

Both machines have now run both stacks, so hardware and stack can be separated
instead of guessed at:

| prefill @ 8k | M5 Pro | 7900 XT | machine effect |
| --- | --- | --- | --- |
| qwen 27B · LM Studio | 414.3 tok/s | 493.6 tok/s | +19% |
| glimmer 30B · Ollama | 442.7 tok/s | **779.0 tok/s** | +76% |
| stack effect | +7% | +58% | |

| generation | M5 Pro | 7900 XT | machine effect |
| --- | --- | --- | --- |
| qwen 27B · LM Studio | 17.13 tok/s | **35.63 tok/s** | +108% |
| glimmer 30B · Ollama | 33.82 tok/s | 32.27 tok/s | **−4.6%** |
| stack effect | +97% | −9% | |

| agentic wall-clock | M5 Pro | 7900 XT | machine effect |
| --- | --- | --- | --- |
| qwen 27B · LM Studio | 134.6 s (thinking off) | 204.0 s (on, spiral) | +52% slower |
| glimmer 30B · Ollama | **68.6 s** | 86.9 s | +27% slower |
| stack effect | 2.0× faster | 2.3× faster | |

| | M5 Pro · qwen | M5 Pro · glimmer | 7900 XT · qwen | 7900 XT · glimmer |
| --- | --- | --- | --- | --- |
| turns / tool calls | 5 / 5 | 6 / 6 | 6 / 5 | 6 / 6 |
| wasted turns | 0 | **0** | 1 (the spiral) | **0** |
| self-check (`list_files`) | no | **yes** | no | **yes** |
| plan steps | 4 | 5 | 4 | 4 |
| app size | 5.2 KB | **4.4 KB** | 8.1 KB | 5.6 KB |
| thinking | off (`--reasoning none`) | on | on | on |
| whole run | 257.6 s | **171.2 s** | 295.0 s | 177.6 s |

**Throughput tracks the machine; convergence tracks the model.** Every agentic
hardware and moved with the model: qwen spiralled on turn 1 in both PC runs, to
the same 4,080 thinking tokens, and spiralled on the Mac too — which is why the
Mac's published qwen run uses `--reasoning none` at all — while glimmer converged
in six clean turns with a `list_files` self-check on both machines, thinking left
on. Not one malformed or invented tool call in four runs, on either backend.
Meanwhile the rates moved by up to 2.1× between machines with the model held
fixed. **These are two independent axes, and only one of them is what a tok/s
benchmark measures.**

**The stack swap is worth more than the hardware.** On the Mac it doubled
generation (+97%) and halved the agentic wall-clock; on the PC it bought +58%
prefill and a 2.3× faster agentic run. Buying the other machine moved the rates by
anywhere from −5% to +108% depending on the stack, and *lost* on agentic time in
both of them.

**Prefill on the PC was leaving 58% on the table.** 493.6 tok/s under LM
Studio/Vulkan against 779.0 under Ollama, same GPU, same afternoon. Model and
backend both moved, so the cause is not isolated — but the hardware is exonerated,
and the two are far enough apart to be worth chasing.

**The one row the PC loses is glimmer's decode**, 32.27 against the Mac's 33.82,
while qwen decodes 2.1× faster on that same PC. The obvious explanation was partial
offload — a 30B model crowding a 20 GB card — and **it is wrong**: `/api/ps` reports
16.7 GB resident with `size_vram` equal to `size`, so the weights are entirely on
the GPU, and at the prompt sizes measured here (≤8.3k tokens) the KV cache is far
too small to change that. Nothing spilled.

What is left is that glimmer's decode is bound by something other than this GPU's
memory bandwidth, since two very different memory systems produce 32.27 and
33.82 tok/s on it while the same PC decodes qwen 2.1× faster than the same Mac
does. Whether that is the model or Ollama's GGUF path needs the diagonal runs
below.

**What is still missing is the diagonal.** Every cell here pairs qwen with LM
Studio and glimmer with Ollama, so model and backend are confounded in every
stack-effect number above. The two runs that would break them apart — **qwen on
Ollama** and **glimmer under LM Studio** — need a second copy of a model pulled
into the other tool, and neither has been run. Until then "stack effect" means
model-and-backend together.

The comparison that survives all of it is the one this benchmark keeps making:
glimmer's 32.27 tok/s and qwen's 35.63 tok/s on the *same PC* are a near dead
heat, yet glimmer finished the agentic task in 86.9 s to qwen's 204.0 s. **Equal
decode speed, a 2.3× wall-clock gap** — thinking discipline, not throughput.

## Prior art

The prefill/decode split and the agentic phase are this benchmark's own, but four
of the measurements above came from reading
[eugr/llama-benchy](https://github.com/eugr/llama-benchy), which brings
llama-bench-style numbers to OpenAI-compatible endpoints: measuring at context
depth, subtracting an estimated latency baseline, reporting run-to-run variance
next to the central number, and reading peak throughput off a one-second window.

Deliberately not taken from it: concurrency sweeps (a serving-capacity question,
where this is a single-user one), local HuggingFace tokenizers (server-reported
`usage` is exact and needs no dependency), and prefix-cache measurement, which is
the direct opposite of what the nonce prefixing here exists to defeat.

Its remaining idea worth revisiting is sourcing prompts from a real book rather
than a repeated filler phrase, so that speculative decoding and MTP are measured
against text they cannot trivially draft. That is a real effect, but it costs the
single-file property this tool is distributed on, and it has not yet been shown to
move the numbers on any stack measured here — so it stays unbought until an
MTP-enabled A/B says otherwise.

## License

MIT — see [LICENSE](LICENSE).
