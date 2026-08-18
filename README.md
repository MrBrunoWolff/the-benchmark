# the-benchmark

Minimal local-LLM server benchmark. One code path, zero dependencies — only the
base URL changes between backends.

Works against any OpenAI-compatible `/v1/chat/completions` endpoint: LM Studio,
Ollama, llama.cpp server, vLLM.

## Usage

Load a model in your backend, then:

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
| `ttft_ms` | Time to first token. With `max_tokens=1` this is essentially pure prompt-processing time | lower |
| `prefill_tok/s` | `prompt_tok / ttft_ms` — input tokens digested per second | higher |
| `took_s` / `took_min` | Wall-clock for that row in both seconds and minutes, covering all `--runs` repeats of it | lower |

### Generation — how fast the model *writes*

Short prompt, `max_tokens=--gen-tokens`.

| Column | Meaning | Better |
| --- | --- | --- |
| `out_tok` | Tokens generated, including any thinking tokens | — |
| `ttft_ms` | Time to first token. Here the prompt is tiny, so this is the request latency floor, not a prefill measurement | lower |
| `gen_tok/s` | `(out_tok - 1) / (total - ttft)` — prefill is excluded, so this is steady-state decode speed. If the response arrives in a single chunk there is no window to measure, so it falls back to `(out_tok - 1) / total` and the run says so | higher |
| `reasoning_tok` | How much of `out_tok` was thinking rather than visible content, when the server reports it. A **subset** of `out_tok`, not an addition to it | — |
| `took_s` / `took_min` | Wall-clock for the whole phase in both seconds and minutes | lower |

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

The spiral is not always fatal, though. On the PC run below, thinking was left
**on** and the model *did* recover: turn 1 burned the full 4,096-token budget on
4,080 thinking tokens and produced no tool call, then turns 2-6 planned, wrote
three files and called `finish` with barely any thinking at all (39, 9, 6, 50,
13 tokens). The cost was one dead turn — 117.2 s, 56% of that run's entire
agentic wall-clock — rather than the whole run.

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
  `/api/v0/models` call to recover them after the fact
- `think_tok` in the agentic table, sitting immediately next to `out_tok` so the
  subset relationship is visible
- `took_s` / `took_min` on every row, and a `TIME TAKEN` block per phase
- the HTML report, which carries the full human-readable name, the unit and an
  explainer for every metric — so the terse keys below only have to serve people
  already looking at a terminal

**Still proposed** for the two older phases, since the agentic table already uses
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
| `reasoning_tok` | `think_tok`, next to `out_tok` | Shorter, and adjacency shows it is a subset — as already done in the agentic table |

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

- **Small prompts measure latency, not throughput.** At a few hundred tokens the
  request round-trip dominates, so `prefill_tok/s` is inflated and noisy. Trust
  the largest size you ran.
- **Medians, not means, for a reason.** Backends cache prompts. A single cached
  run can report an order-of-magnitude-too-high prefill rate; the median rejects
  it. Keep `--runs` at 3 or more, and inspect `--json` if a number looks too
  good. Prompt caching is *mostly* defeated (see below) but not perfectly.
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
- **`temperature: 0`** for run-to-run stability.
- **Cold-load time is not measured** — that needs an unload between runs, which
  has no portable API across backends. Restart the backend and watch the warmup
  if you care about it.
- **The Ollama path has now been verified on a live Ollama server**, and it holds
  the same OpenAI-compatible contract: `stream_options: {include_usage: true}`
  returns an exact `usage` block, so the fallback to counting stream chunks never
  triggered. It did expose two timing bugs — Ollama names its thinking delta
  `reasoning`, not `reasoning_content`, and ships the whole tool call in one final
  SSE chunk — both now fixed; see [what this run broke](#what-this-run-broke).
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

## Results

Three full runs, all post-cache-fix and all with all three phases.

The first two are the same model (`qwen/qwen3.8-27b`, 4-bit) on two of my
machines. The *runtimes differ* — MLX/Metal on the Mac, GGUF/Vulkan on the PC —
so that pair compares two whole stacks, not two GPUs. They also differ in one
benchmark setting: the Mac ran `--reasoning none`, the PC ran with thinking left
on, which matters only for the agentic phase.

The third is the same Mac running `muse-glimmer:30b-mlx` on **Ollama** — a
different model, backend and quantisation, and the run that finally exercised the
Ollama path. It is the fastest agentic run here, and it exposed several columns
the instrument reports wrongly on that backend; all of them are documented.

### MacBook Pro · Apple M5 Pro · qwen on LM Studio

18-core CPU (6 Super + 12 Performance) · 20-core GPU · 48 GB unified memory ·
macOS 26.6.1 · LM Studio on MLX (Metal) · `qwen/qwen3.8-27b` 4-bit @ 119,552 ctx ·
`--reasoning none`

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s       took_s (took_min)
         284      932.5            304.6         2.7s (0.05m)
        2077     5143.1            403.8        15.5s (0.26m)
        8221    20212.7            406.7        60.9s (1.02m)
  total 79.1s (1.32m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok       took_s (took_min)
      255      532.3        16.99               0        46.5s (0.78m)
  total 46.5s (0.78m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s       took_s (took_min)   action
     1        784          1072.4         84            0        18.35         5.6s (0.09m)   plan(4 steps)
     2        896          1068.3        607            0        16.46        37.9s (0.63m)   write_file(index.html, 1.8 KB)
     3       1531          1758.9        837            0        16.81        51.5s (0.86m)   write_file(styles.css, 1.8 KB)
     4       2396          1010.5        499            0        17.18        30.0s (0.50m)   write_file(app.js, 1.7 KB)
     5       2923           951.6        161            0        17.78        10.0s (0.17m)   finish

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               134.9
    wall_clock_min             2.25
    turns_used                 5 / 12
    tool_calls                 5 (0 malformed, 0 unknown)
    turns_without_a_tool_call  0
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 4
    input_tok_total            8,530
    output_tok_total           2,188
    thinking_tok_total         0
    decode_tok_s_median        17.18

TIME TAKEN
  Prompt processing  79.1s (1.32m)
  Generation         46.5s (0.78m)
  Agentic coding    134.9s (2.25m)
  Whole run         261.3s (4.36m)
```

Prefill settles at **~405 tok/s**, agreeing closely between 2k and 8k. Generation
holds **~17 tok/s**.

> An earlier hand-run on this machine reported 470 and 446 tok/s at 2k and 8k.
> Those were taken before the cross-process cache fix described in the design
> notes, so they were partly served from the on-disk prompt cache. The ~405
> figures above are the honest ones.

The 284-token row reads *lower* than the larger sizes, as it does on the PC
below now that the cache fix has landed there too: ~900 ms of fixed per-request
overhead simply outweighs 284 tokens of work. Further evidence the row carries no
signal.

#### The agentic run

With thinking off it is a clean run: **5 turns, 5 tool calls, zero malformed,
zero wasted turns** — the minimum possible path through the task — producing a
working three-file app in 134.9 s.

- **Tool-call discipline is perfect once it stops thinking.** No malformed JSON,
  no invented tools, no prose-instead-of-action turns. The protocol was never the
  weak spot; the reasoning budget was.
- **`ctx_tok` nearly quadruples** across five turns (784 → 2,923) purely from
  feeding results back. `input_tok_total` of 8,530 against 2,188 output tokens is
  the re-prefill tax: this loop spent **nearly 4× more tokens re-reading its own
  transcript than producing anything**. That ratio, not tok/s, is what makes long
  agent sessions expensive.
- **`first_tok_ms` stays roughly flat** (~1,000 ms) even as `ctx_tok` grows,
  because prompt caching is left enabled here and each turn only re-prefills the
  new suffix.
- **Decode holds ~17 tok/s**, matching the generation phase, so the agent loop
  costs nothing in throughput beyond the extra context.
- **`took_s` is dominated by output length, not context.** The two 1.8 KB files
  cost 38 s and 52 s; `finish` cost 10 s. At ~17 tok/s, writing files *is* the
  wall-clock.

The app it produced is genuinely usable — labelled inputs, `aria-live="polite"`
on the results region, live recalculation on `input`, values clamped, no CDNs.

### Desktop · Ryzen 7 5800X3D + Radeon RX 7900 XT · qwen on LM Studio

Radeon RX 7900 XT 20 GB · 31 GB RAM · LM Studio on Vulkan ·
`qwen/qwen3.8-27b` Q4_K_M GGUF @ 119,552 ctx · thinking left **on** (no
`--reasoning` flag) · GPU offload not recorded by the benchmark

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)
         327      946.8            345.4                2.9s (0.05m)
        2120     4489.7            472.2               13.3s (0.22m)
        8264    16760.8            493.1               50.2s (0.84m)
  total 66.4s (1.11m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)
      256      692.0        35.24             256               23.8s (0.40m)
  total 23.8s (0.40m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        820          2134.9       4096         4080        35.58              117.2s (1.95m)   no tool call (hit the 4096-token cap)
     2        854           927.8        134           39        36.46                4.6s (0.08m)   plan(4 steps)
     3        975           510.8        890            9        41.84               21.8s (0.36m)   write_file(index.html, 2.8 KB)
     4       1882          1966.3       1464            6        40.55               38.0s (0.63m)   write_file(styles.css, 3.4 KB)
     5       3366          3110.6        711           50        36.93               22.3s (0.37m)   write_file(app.js, 2.3 KB)
     6       4053          1640.3        172           13        30.89                7.2s (0.12m)   finish

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               211.1
    wall_clock_min             3.52
    turns_used                 6 / 12
    tool_calls                 5 (0 malformed, 0 unknown)
    turns_without_a_tool_call  1 — 1 of them ran out of output budget mid-thought
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 4
    input_tok_total            11,950
    output_tok_total           7,467
    thinking_tok_total         4,197
    decode_tok_s_median        36.69

TIME TAKEN
  Prompt processing  66.4s (1.11m)
  Generation         23.8s (0.40m)
  Agentic coding     211.1s (3.52m)
  Whole run          302.3s (5.04m)
```

Prefill settles at **~490 tok/s**, generation at **~35 tok/s**.

The 327-token row now reads **345 tok/s** — *below* the larger sizes, matching the
Mac's shape. The earlier pre-fix run reported 905 tok/s on that same row, which
was the on-disk prompt cache, not the GPU. The latency-floor artefact is real but
it depresses the small row; it does not double it.

> This supersedes the earlier partial run on this machine (452.6 / 463.3 tok/s
> prefill, 12.96 tok/s generation, `n_gpu_layers=56`, 80,384 ctx, agentic not
> run). Those prefill figures predated the cross-process cache fix, and decode
> was measured under partial CPU offload. Everything above is post-fix and
> includes the agentic phase.

#### The agentic run

It converged — **6 turns, 5 tool calls, zero malformed, zero unknown tools** —
but it paid a turn for it, and that turn dominates the run:

- **Turn 1 produced nothing.** 4,096 output tokens, 4,080 of them thinking,
  `finish_reason: length`, no tool call. That is the reasoning spiral, and at
  117.2 s it is **56% of the 211.1 s agentic wall-clock**. Turns 2-6 then used
  3,371 output tokens and 117 thinking tokens total to do the entire task.
- **Faster decode, slower run.** Decode is 36.69 tok/s median here against the
  Mac's 17.18 — 2.1× faster — yet the agentic phase took 211.1 s versus the Mac's
  134.9 s. One wasted thinking turn more than ate a doubling of throughput. This
  is the clearest single argument in the whole benchmark for why tok/s is not the
  number that matters for agent work.
- **Thinking inflates output, not context.** `output_tok_total` is 7,467 against
  the Mac's 2,188, almost entirely the 4,197 thinking tokens. The
  re-prefill ratio therefore looks *better* here (11,950 in / 7,467 out = 1.6×
  versus the Mac's 3.9×) — an artefact of wasted output, not of a cheaper loop.
- **`first_tok_ms` is noisier than the Mac's** (511 ms to 3,111 ms, not tracking
  `ctx_tok` monotonically). Caching is clearly working: at ~490 tok/s an uncached
  4,053-token prefill would cost ~8 s, and turn 6 started in 1.6 s.
- **It writes more.** 8.5 KB across three files versus the Mac's 5.3 KB, with the
  same 4-step plan and the same file set — the thinking-on run is simply more
  verbose.

### Side by side — the two qwen runs

| | M5 Pro (MLX) | 7900 XT (Vulkan) |
| --- | --- | --- |
| prefill @ 2k | 403.8 tok/s | **472.2 tok/s** |
| prefill @ 8k | 406.7 tok/s | **493.1 tok/s** |
| ttft @ 8k | 20.2 s | **16.8 s** |
| generation | 16.99 tok/s | **35.24 tok/s** |
| agentic, converged | yes — 5 turns / 134.9 s | yes — 6 turns / 211.1 s |
| wasted turns | 0 | 1 (the spiral, 117.2 s) |
| decode, agentic median | 17.18 tok/s | **36.69 tok/s** |
| `--reasoning` | `none` | server default (on) |

Both machines' figures are now post-cache-fix, so the comparison holds.

**The PC wins every raw-speed row.** Prefill is ~21% faster at 8k and decode is
**2.1× faster** — the reverse of the earlier, partly-cached and partly-offloaded
numbers, which had the Mac ahead on generation. Decode nearly tripling (12.96 →
35.24 tok/s) on the same GPU and quant is far too large to be run-to-run noise,
and the likeliest cause is that the layers no longer spill to the CPU. The
benchmark's `runtime` header only records backend, quant and context length, not
`n_gpu_layers`, so that remains an inference rather than a measurement.

**The Mac wins the only row a user feels.** It finished the agentic task in 134.9 s
to the PC's 211.1 s, at half the decode speed, because it never spent a turn
thinking. Run the PC with `--reasoning none` and it should finish the same five
turns at ~2× the Mac's rate; that is the run still missing.

Remaining caveat: different quantisations, MLX 4-bit versus GGUF Q4_K_M. Loaded
context length is no longer one — both ran at 119,552. The reasoning spiral is a
model property, not a hardware one; it reproduced on both machines, and the only
reason the PC escaped it is that turn 1's dead end left a usable transcript
behind.

### MacBook Pro · muse-glimmer 30B on Ollama

Same Mac as above, different everything else: different model, different backend,
different quantisation. This is the first run against a **live Ollama server**, so
it retires the "unverified" caveat in the design notes — and it is also the run
that caught the Ollama path reporting several columns wrongly. Those are called
out under [what this run broke](#what-this-run-broke) rather than quietly left in
the table.

18-core CPU (6 Super + 12 Performance) · 20-core GPU · 48 GB unified memory ·
macOS 26.6.1 · Ollama on `localhost:11434` · `muse-glimmer:30b-mlx` — 32.3B params,
`nvfp4`, 131,072 ctx per `/api/show` · thinking left **on** (no `--reasoning` flag)

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s              took_s (took_min)
         329      787.5            417.8                2.4s (0.04m)
        2122     4654.5            455.9               13.7s (0.23m)
        8266    18744.2            441.0               56.3s (0.94m)
  total 72.3s (1.21m) for 3 sizes × 3 runs

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok              took_s (took_min)
      256     7298.5        34.94               0               22.1s (0.37m)
  total 22.1s (0.37m) for 3 runs

AGENTIC CODING  — plan → write files → finish, max 12 turns, 4096 max_tokens/turn
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        888         11853.9        302            0   3742989.67               11.9s (0.20m)   plan(5 steps)
     2       1037         14215.8        479            0   4972691.81               14.2s (0.24m)   write_file(index.html, 1.3 KB)
     3       1529         17658.6        533            0  11259259.26               17.7s (0.29m)   write_file(styles.css, 1.3 KB)
     4       2092         16142.4        545            0   8079127.93               16.1s (0.27m)   write_file(app.js, 1.7 KB)
     5       2667          1285.4         28            0    604486.63                1.3s (0.02m)   list_files(3)
     6       2725          4320.1        104            0   2286805.35                4.3s (0.07m)   finish

  AGENTIC SUMMARY
    finished                   yes — called finish
    wall_clock_s               65.5
    wall_clock_min             1.09
    turns_used                 6 / 12
    tool_calls                 6 (0 malformed, 0 unknown)
    turns_without_a_tool_call  0
    stalled_turns              0 (180s deadline per turn)
    files_written              3 — index.html, styles.css, app.js
    plan_steps                 5
    input_tok_total            10,938
    output_tok_total           1,991
    thinking_tok_total         0
    decode_tok_s_median        4357840.74

TIME TAKEN
  Prompt processing  72.3s (1.21m)
  Generation         22.1s (0.37m)
  Agentic coding     65.5s (1.09m)
  Whole run          160.8s (2.68m)
```

Prefill settles at **~445 tok/s**, agreeing between 2k and 8k. Generation runs at
**34.94 tok/s**. The 329-token row reads low again (417.8), the same
latency-floor shape both other runs show.

#### The agentic run

**65.5 s, 6 turns, 6 tool calls, zero malformed, zero unknown, zero wasted
turns** — and it did that with thinking left *on*. It is the fastest agentic run
in this README by a wide margin: less than half the Mac's qwen run (134.9 s) and
under a third of the PC's (211.1 s).

- **It converged with thinking on and wasted nothing doing it.** No spiral, no
  dead first turn, no `--reasoning none` needed. The PC's qwen run also converged
  with thinking on, but only after burning turn 1 — 117.2 s — on the spiral. That
  difference is a model property, not a hardware one: the same Mac produced the
  spiral under qwen.
- **It took one extra turn on purpose.** Turn 5 is a `list_files` call: it
  verified the three files existed before calling `finish`. That is the only run
  here that checked its own work, and it cost 1.3 s.
- **It writes tighter.** 4.4 KB across three files against the Mac-qwen run's
  5.3 KB and the PC's 8.5 KB, from 1,991 output tokens — the fewest of the three,
  despite a 5-step plan rather than 4.
- **The re-prefill tax is the worst of the three.** 10,938 input against 1,991
  output is **5.5×**, versus the Mac-qwen run's 3.9× and the PC's 1.6×. Short
  turns make the ratio worse, not better: every turn still re-reads the whole
  transcript, so a loop that produces less per turn pays proportionally more.

The app is genuinely good — `<label>` on every input, `aria-live="polite"` and
`aria-atomic` on the results region, `Intl.NumberFormat` currency, validation
that degrades to `$0.00` rather than `NaN`, no CDNs.

#### What this run broke

Several columns are wrong on the Ollama path, and the `out_tok/s` figures above —
3.7 million tokens per second — are the giveaway. The cause is how Ollama streams
a tool call, verified directly against the server:

- **Ollama emits the entire tool call in one final SSE chunk.** In a 23.1 s probe
  request, the `tool_calls` delta arrived at 23.14 s — event 150 of 152.
  Everything before it was `reasoning` deltas.
- **The benchmark only marks TTFT on `delta.content`, `delta.reasoning_content`
  or `delta.tool_calls`.** Ollama names its thinking delta `reasoning`, not
  `reasoning_content`, so nothing marks TTFT until that final chunk lands.

So on every tool-calling turn, `first_tok_ms` collapses onto the turn's own
wall-clock — look at the table: 11853.9 ms against 11.9 s, 14215.8 against 14.2 s,
all six rows. And `out_tok/s`, which is `(out_tok - 1) / (total - ttft)`, divides
by ~0.

| Column | On Ollama | Read it as |
| --- | --- | --- |
| `first_tok_ms` (agentic) | ✗ | Whole-turn latency, not time to first token |
| `out_tok/s` (agentic) | ✗ | Meaningless — `decode_tok_s_median` too |
| `think_tok` / `thinking_tok_total` | ✗ | Always 0; Ollama omits `reasoning_tokens` from `usage` and this model thought on every turn |
| `ttft_ms` (generation) | ✗ | The whole request. This model spent all 256 tokens on reasoning, emitting no visible content, so nothing ever marked TTFT |
| `gen_tok/s` | ✓ | Correct — the `ttft ?? 0` fallback makes it `(out_tok - 1) / total`, an honest end-to-end rate with thinking included |
| `prefill_tok/s` | ✓ | Correct — `max_tokens=1`, so `ttft ≈ total ≈ prefill` by construction |
| everything counted (`ctx_tok`, `out_tok`, `input_tok_total`) | ✓ | Exact — `stream_options: {include_usage: true}` gets a real `usage` block |
| convergence (`finished`, `tool_calls`, `files_written`, `wall_clock_s`) | ✓ | Exact, and it is the headline of this phase anyway |

Recomputed the honest way — `out_tok / took_s` per turn — the agentic decode rate
is 21.5 to 33.9 tok/s, median **~27.8**, consistent with the generation phase's
34.94. The instrument was wrong; the machine was not.

Two further findings from the same probing, both correcting things this README
previously assumed:

- **Ollama honours `reasoning_effort`.** `none` took a 95-reasoning-delta
  response to zero. So `--reasoning none` is a live lever here too — this run
  simply did not use it.
- **Ollama returns an exact `usage` block** when asked via `stream_options`, so
  the "falls back to counting stream chunks" caveat never triggered.

#### The fix, and the same run after it

Both are now fixed, in the same commit as this section:

- **TTFT marks on `delta.reasoning` too**, not just `delta.reasoning_content`.
  Thinking deltas are the model producing tokens, so they start the clock.
- **`genTps` no longer divides by a zero window.** When the whole response
  arrives in one chunk there is no steady state to measure, so it falls back to
  the end-to-end rate `(out_tok - 1) / total` and the run prints a note saying
  which rows that applies to.

Re-running the identical agentic task at `temperature: 0` reproduces the same six
turns and the same three files, so this is a clean before/after of the
*instrument*, not of the model:

```
  turn    ctx_tok    first_tok_ms    out_tok    think_tok    out_tok/s              took_s (took_min)   action
     1        888          1899.2        302            0        31.97               11.3s (0.19m)   plan(5 steps)
     2       1037           665.1        479            0        36.67               13.7s (0.23m)   write_file(index.html, 1.3 KB)
     3       1529         17290.0        533            0        30.77               17.3s (0.29m)   write_file(styles.css, 1.3 KB)
     4       2092         15506.2        545            0        35.08               15.5s (0.26m)   write_file(app.js, 1.7 KB)
     5       2667          1286.8         28            0        20.98                1.3s (0.02m)   list_files(3)
     6       2725          4238.2        103            0        24.07                4.2s (0.07m)   finish
  note: 4 turns arrived in one chunk; on those rows first_tok_ms is the whole turn and out_tok/s is end-to-end, not steady-state decode

    wall_clock_s               63.3
    decode_tok_s_median        31.37
```

`decode_tok_s_median` lands at **31.37 tok/s** — against 4,357,840.74 before, and
within a token or two of the 27.8 hand-computed above. The generation phase
recovers too: `ttft_ms` drops from 7298.5 to **416–502 ms**, and `gen_tok/s`
rises from 34.94 to **35.8–38.8**, because it is finally excluding prefill
instead of averaging over the whole request.

The split the note reports is itself the finding. **Turns 1 and 2 streamed
thinking** and now have a genuine TTFT. **Turns 3 to 6 emitted no reasoning at
all** — the model had its plan and just wrote — so those turns really are one
chunk, and no amount of instrumentation can recover a decode rate from them. The
fallback is labelled rather than hidden.

Everything in the tables above this subsection was produced by the pre-fix
instrument and is published as it printed, artefacts and all — it is the evidence
for the bug. Re-run against the current code and the two ✗ agentic columns and
the generation `ttft_ms` will read correctly; `think_tok` still will not, because
Ollama omits `reasoning_tokens` from `usage` entirely.

### Same machine, three stacks

The Mac ran twice, which pins the hardware while the whole stack changes:

| | M5 Pro · qwen 27B · LM Studio/MLX | M5 Pro · glimmer 30B · Ollama | 7900 XT · qwen 27B · LM Studio/Vulkan |
| --- | --- | --- | --- |
| prefill @ 2k | 403.8 tok/s | 455.9 tok/s | **472.2 tok/s** |
| prefill @ 8k | 406.7 tok/s | 441.0 tok/s | **493.1 tok/s** |
| generation | 16.99 tok/s | 34.94 tok/s | **35.24 tok/s** |
| agentic wall-clock | 134.9 s | **65.5 s** | 211.1 s |
| turns / tool calls | 5 / 5 | 6 / 6 | 6 / 5 |
| wasted turns | 0 | **0** | 1 (the spiral) |
| thinking | off (`--reasoning none`) | **on** | on |
| whole run | 261.3 s | **160.8 s** | 302.3 s |

Three variables move at once between the first two columns — model, backend and
quantisation — so this is not a clean attribution. What it does show is that on
the *same 48 GB Mac*, swapping the whole stack **doubled generation throughput**
(16.99 → 34.94 tok/s, matching the 7900 XT) and **halved the agentic wall-clock**
even with thinking left on. Which of the three variables bought that is the next
run to isolate: qwen on Ollama, and glimmer under LM Studio's MLX runtime.

The comparison that survives all of it is the one this benchmark keeps making:
glimmer's 34.94 tok/s and the 7900 XT's 35.24 tok/s are a dead heat, yet glimmer
finished the agentic task in 65.5 s to the PC's 211.1 s. **Same decode speed, a
3.2× wall-clock gap** — thinking discipline, not throughput.

## License

MIT — see [LICENSE](LICENSE).
