# the-benchmark

Minimal local-LLM server benchmark. One code path, zero dependencies — only the
base URL changes between backends.

Works against any OpenAI-compatible `/v1/chat/completions` endpoint: LM Studio,
Ollama, llama.cpp server, vLLM.

## Usage

Load a model in your backend, then:

```bash
bun run lmstudio          # http://localhost:1234 — prefill + generation
bun run ollama            # http://localhost:11434
bun run agentic           # only the agentic coding run
bun run all               # all three phases
node bench.mjs --url http://localhost:8080   # anything else
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
| `--target` | `lmstudio` | `lmstudio` (1234) or `ollama` (11434) |
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
| `gen_tok/s` | `(out_tok - 1) / (total - ttft)` — prefill is excluded, so this is steady-state decode speed | higher |
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
| `out_tok/s` | Decode speed, as in the generation phase | higher |
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
- **The Ollama path is written against the same OpenAI-compatible contract but
  has not been verified on a live Ollama server.** It falls back to counting
  stream chunks if `usage` is absent, as older builds omit it.
- **The agentic phase is opt-in** because it costs far more wall-clock than the
  other two: worst case is `--max-turns × --turn-timeout`. Keeping it off
  `bun run lmstudio` means the quick numbers stay quick.
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

Same model (`qwen/qwen3.8-27b`, 4-bit) on two of my machines. The *runtimes
differ* — MLX/Metal on the Mac, GGUF/Vulkan on the PC — so this compares two
whole stacks, not two GPUs.

### MacBook Pro · Apple M5 Pro

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

The 284-token row reads *lower* than the larger sizes, the reverse of the PC
below. Same latency-floor artefact in both cases: ~900 ms of fixed per-request
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

### Desktop · Ryzen 7 5800X3D + Radeon RX 7900 XT

Radeon RX 7900 XT 20 GB · 31 GB RAM · LM Studio on Vulkan, `n_gpu_layers=56` ·
`qwen/qwen3.8-27b` Q4_K_M GGUF @ 80,384 ctx

```
PROMPT PROCESSING (prefill)  — max_tokens=1, unique prompt per run
  prompt_tok    ttft_ms    prefill_tok/s
         316      349.0            905.3
        2109     4659.8            452.6
        8253    17814.8            463.3

GENERATION  — max_tokens=256, short prompt
  out_tok    ttft_ms    gen_tok/s   reasoning_tok
      256      644.1        12.96             197
```

Prefill settles at **~460 tok/s**, generation at **~13 tok/s**. The 316-token row
is the latency-floor artefact — ignore it.

**These numbers predate the cache fix**, so they are very likely inflated the same
way the Mac's first run was, and the agentic phase has not been run here at all.
They need re-running before the comparison below means much.

### Side by side

| | M5 Pro (MLX) | 7900 XT (Vulkan) |
| --- | --- | --- |
| prefill @ 2k | 403.8 tok/s | 452.6 tok/s * |
| prefill @ 8k | 406.7 tok/s | 463.3 tok/s * |
| ttft @ 8k | 20.2 s | 17.8 s * |
| generation | **16.99 tok/s** | 12.96 tok/s * |
| agentic, converged | 5 turns / 134.9 s | not run |

\* measured before the cross-process cache fix — treat as an upper bound.

**Generation goes to the Mac, ~31% faster**, and this is the one row the cache bug
cannot have distorted, since decode speed is measured after prefill. That is the
expected shape: decode is bandwidth-bound, and unified memory feeds a 27B 4-bit
model without the partial offload the 7900 XT needs (`n_gpu_layers=56` — the
remaining layers run on the CPU, at CPU memory speed).

**Prefill is unresolved.** On the numbers as they stand the PC looks ~13% ahead,
but its figures come from the pre-fix code and the Mac's equivalent figures fell
~13% once the fix landed. Those two effects are the same size, so the honest
answer is that this row needs a re-run on the PC before anyone draws a conclusion
from it.

Other caveats: different quantisations (MLX 4-bit vs GGUF Q4_K_M) and different
loaded context lengths. Neither should move prefill or decode rates much, but
they are not zero. The agentic result is a model-and-runtime property more than a
hardware one — the reasoning spiral would very likely reproduce on the PC, just
at ~13 tok/s instead of ~17.

## License

MIT — see [LICENSE](LICENSE).
