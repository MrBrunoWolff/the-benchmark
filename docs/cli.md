# Benchmark CLI reference

[Project overview](../README.md)

## Run it without cloning

One file, zero dependencies, nothing to clone. Load a model in LM Studio or Ollama
first — the backend is auto-detected.

```bash
bunx the-benchmark                                                # prefill + generation, under a minute
bunx the-benchmark --phases concurrent                            # how many requests at once this box serves
bunx the-benchmark --phases prefill,generation,concurrent,agentic # everything, several minutes
npx -y the-benchmark                                              # same, via npm
```

Published as [`the-benchmark`](https://www.npmjs.com/package/the-benchmark) — no CLI
dependencies, Node 18+ for the CLI and Node 22.22+ for Studio.

If you keep a supply-chain delay on npm installs, a freshly published version will
not be used until it ages out — and **how that shows up depends on whether you pin
the version**, which is worth knowing because one of the two forms is silent.

Pin it and the refusal is loud:

```
$ bunx the-benchmark@0.3.0
error: No version matching "the-benchmark" found for specifier "0.3.0"
       (blocked by minimum-release-age: 259200 seconds)
```

Leave it unpinned and bun quietly resolves to the newest release that _has_ aged
out — an older version — with no warning at all:

```
$ bunx the-benchmark --phases concurrent
unknown phase "concurrent"; expected one or more of: prefill, generation, agentic
```

That error is the giveaway: it lists the phases of the _old_ version. A flag that
the README documents and the CLI rejects almost always means you are running an
older build than you think, not that the feature is missing. Check with
`bunx the-benchmark@<version>`, which fails loudly rather than downgrading.

Either way it is your own guard doing its job, not a broken package — bun reads
`minimumReleaseAge` from `~/.bunfig.toml`, and neither `--minimum-release-age=0` nor
a local `bunfig.toml` overrides it for `bunx`. Wait it out, use `npx` (which does
not read bunfig), or use the file form, which needs nothing but Node:

```bash
curl -fsSL https://raw.githubusercontent.com/MrBrunoWolff/the-benchmark/main/bench.mjs -o bench.mjs
node bench.mjs
```

There is no git-spec shortcut worth documenting: `bunx` rejects git and
local-tarball specs outright, and `npx github:…` is blocked by default on npm 12
(`allow-git = "none"`).

### Standalone binaries

Releases also carry self-contained binaries that need neither Node nor Bun
installed — handy for benchmarking a box you would rather not put a toolchain on.

```bash
./the-benchmark-linux-x64 --phases prefill,generation
```

They are large (roughly 60–80 MB each), because each one embeds a runtime. `npx`
and `bunx` above remain the primary entry points; this is an extra, not a
replacement. Build them yourself with `bun run build:binaries`.

## Usage

Cloned instead? Load a model in your backend, then:

```bash
bun run bench             # auto-detect the running local server
bun run concurrent        # only the concurrency sweep
bun run gallery           # nine SVGs drawn at once, watched live
bun run agentic           # only the agentic coding run
bun run all               # all four phases
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

To find out how many agents one local server can actually sit behind, sweep the
number of requests in flight at once and watch it happen:

```bash
node bench.mjs --phases concurrent --concurrency 1,2,4,8
```

Four phases: **prefill**, **generation**, **concurrent**, and **agentic**. The
first two run by default and take under a minute. The other two are opt-in via
`--phases` — `concurrent` because it needs a server configured for parallel
requests to mean anything, `agentic` because it is a real multi-turn agent loop.
Expect several minutes for either.

On a **thinking** model, add `--reasoning none` or it will very likely never act
at all:

```bash
node bench.mjs --phases agentic --reasoning none
```

See [The reasoning spiral](#the-reasoning-spiral) for why.

Runs under `bun` or `node` (needs Node 18+ for `fetch` streaming).

The model is auto-detected — on LM Studio it queries `/api/v0/models` and picks
the currently _loaded_ one, so it will not accidentally JIT-load a cold model.
Override with `--model`.

## Flags

| Flag             | Default                | Meaning                                                                                                                                                                                    |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--target`       | auto                   | Force `lmstudio` (1234) or `ollama` (11434); otherwise detect what is running                                                                                                              |
| `--url`          | —                      | Explicit base URL; overrides `--target`                                                                                                                                                    |
| `--model`        | auto                   | Model id to benchmark                                                                                                                                                                      |
| `--runs`         | `3`                    | Runs per size; median is reported                                                                                                                                                          |
| `--sizes`        | `256,2048,8192`        | Approx prompt sizes for the prefill test                                                                                                                                                   |
| `--gen-tokens`   | `256`                  | `max_tokens` for the generation test                                                                                                                                                       |
| `--depth`        | `0`                    | Context depths for the generation test — decode is measured behind a preloaded context of each size, so `0,4096,16384` shows how much the model slows as the KV cache fills                |
| `--latency-mode` | `generation`           | How the request floor is measured before it is subtracted from prefill: `generation` (a one-token request), `api` (a `/v1/models` fetch), or `none` to skip it and drop the `est_` columns |
| `--phases`       | `prefill,generation`   | Phases to run; `system-one` adds typed decisions against local models and Jev                                                                                                              |
| `--concurrency`  | `1,2,4,8`              | Concurrency: slot counts to sweep. In gallery mode the widest level is the pool size                                                                                                       |
| `--conc-tokens`  | `192`                  | Concurrency: `max_tokens` per slot in the sweep                                                                                                                                            |
| `--scenario`     | `bench`                | Concurrency: `bench` for the measurement sweep, or `svg` / `ascii` / `code` / `translate` for a gallery                                                                                    |
| `--topic`        | per scenario           | Gallery: what the tasks are about — a subject for `svg`/`ascii`/`code`, the sentence itself for `translate`                                                                                |
| `--tasks`        | widest `--concurrency` | Gallery: how many tasks to produce. May exceed the slot count; slots pull from one queue                                                                                                   |
| `--no-live`      | off                    | Turn off the in-place live dashboard on a TTY (it is already off when stdout is not one)                                                                                                   |
| `--max-turns`    | `12`                   | Agentic: turn cap before the run is called unconverged                                                                                                                                     |
| `--turn-tokens`  | `4096`                 | Agentic: `max_tokens` per turn — must fit the thinking **and** the tool call                                                                                                               |
| `--turn-timeout` | `180`                  | Agentic: seconds a single turn may take before it is recorded as stalled                                                                                                                   |
| `--reasoning`    | server default         | Pass through as `reasoning_effort` (`none`, `low`, `medium`, `high`). `none` is often required to get a thinking model through the agentic phase                                           |
| `--out`          | `out`                  | Agentic: where the generated app and report are written (gitignored)                                                                                                                       |
| `--json`         | off                    | Also dump raw per-run results as JSON                                                                                                                                                      |

## Metrics

Four phases, measured separately, because they are bound by different things:
prefill is compute-bound, generation is memory-bandwidth-bound, concurrency is
bound by how the server shares both, and the agentic loop is bound by whether the
model can hold a tool protocol together at all. A machine — or a model — can win
one and lose the others.

### Prompt processing (prefill) — how fast the model _reads_

Sent with `max_tokens=1`, so the request finishes as soon as prefill does.

| Column                | Meaning                                                                                                                                                   | Better |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `prompt_tok`          | Input size in tokens, as counted by the server (not estimated)                                                                                            | —      |
| `ttft_ms`             | Time to first token. With `max_tokens=1` this is essentially pure prompt-processing time — but it still contains the request round trip                   | lower  |
| `est_ppt_ms`          | `ttft_ms` minus the measured request floor, so it approximates what the server alone spent reading the prompt                                             | lower  |
| `prefill_tok/s`       | `prompt_tok / ttft_ms` — input tokens digested per second, round trip included                                                                            | higher |
| `est_tok/s`           | `prompt_tok / est_ppt_ms` — the same rate with the round trip removed. **Prefer this one**                                                                | higher |
| `spread`              | Half the observed range across `--runs` repeats, as a percentage of the median. A few percent is noise; tens of percent means one run behaved differently | lower  |
| `took_s` / `took_min` | Wall-clock for that row in both seconds and minutes, covering all `--runs` repeats of it                                                                  | lower  |

The floor is measured once per run, after warmup, and printed in the header. It
is a fixed cost on every row: against an 8k prompt it is rounding error, at 256
tokens it is most of the elapsed time. Against a mock server pinned at a true
1,000 tok/s, `prefill_tok/s` reads **851** at 256 tokens while `est_tok/s`
recovers **1,011**.

It is also per-backend and has to be measured rather than assumed — LM Studio's
floor came in at 369ms against Ollama's 255ms on the same machine, which is the
opposite of the obvious guess about which one carries more overhead.

**This corrects the advice in [Reading the results](#reading-the-results).** Small
prompts do not read _inflated_ — a fixed per-request cost divided by very few
tokens can only drag a rate down, and every run in [Results](results.md#results) shows the
smallest row lower than the 2k row, not higher. That rising trend is the artefact:
attention cost grows with sequence length, so per-token prefill should get slower
as prompts get longer. With the floor subtracted it does.

### Generation — how fast the model _writes_

Short question, `max_tokens=--gen-tokens`, one row per `--depth`.

| Column                | Meaning                                                                                                                                                                                                                                                                 | Better |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `ctx_tok`             | Context actually sent, counted by the server. At `--depth 0` this is just the question; above it, the preloaded context                                                                                                                                                 | —      |
| `out_tok`             | Tokens generated, including any thinking tokens                                                                                                                                                                                                                         | —      |
| `think_tok`           | How much of `out_tok` was thinking rather than visible content, when the server reports it. A **subset** of `out_tok`, not an addition to it — which is why it sits next to it                                                                                          | —      |
| `ttft_ms`             | Time to first token. At depth 0 the prompt is tiny, so this is the request latency floor; at depth it is dominated by reading the preloaded context                                                                                                                     | lower  |
| `gen_tok/s`           | `(out_tok - 1) / (total - ttft)` — prefill is excluded, so this is steady-state decode speed. If the response arrives in a single chunk there is no window to measure, so it falls back to `(out_tok - 1) / total` and the run says so                                  | higher |
| `spread`              | Half the observed range across `--runs` repeats, as a percentage of the median                                                                                                                                                                                          | lower  |
| `peak_tok/s`          | The best one-second window, against `gen_tok/s` which is the whole-request average. A large gap means the run was not steady — throttling, memory pressure, or another process competing. Blank when the stream lasted under a second, since there is no window to read | higher |
| `took_s` / `took_min` | Wall-clock for that row in both seconds and minutes                                                                                                                                                                                                                     | lower  |

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

### Concurrency — how many at _once_

Every other phase sends one request at a time, which measures the **model**. This
one fires N at once and measures the **server**: whether one local backend can sit
behind more than a single agent, and how much it costs each of them when it does.

```bash
node bench.mjs --phases concurrent                          # sweep 1, 2, 4, 8
node bench.mjs --phases concurrent --concurrency 1,2,4,8,16
```

Each level sends N copies of the same request shape the generation phase uses —
unique nonce per slot, so no two share a cache prefix — and starts them in the
same tick, so the measurement is a load and not a ramp.

| Column        | Meaning                                                                                                                   | Better |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| `slots`       | How many requests were in flight together                                                                                 | —      |
| `overlap`     | How many were _actually_ streaming at the same moment, averaged over the level. **Read this one first**                   | higher |
| `agg_tok/s`   | Every slot's output tokens over the level's wall clock. Prompt processing is inside that window, so this is total goodput | higher |
| `slot_tok/s`  | Median steady-state decode of _one_ stream while the others compete with it                                               | higher |
| `ttft_ms`     | Median time to first token across slots — half the callers waited longer                                                  | lower  |
| `max_ttft_ms` | The unluckiest slot. The gap from the median is queueing                                                                  | lower  |
| `scale`       | `agg_tok/s` relative to the first level in the sweep                                                                      | higher |
| `eff`         | `scale` divided by the slot ratio. 100% would be one full slot of throughput per added slot                               | higher |
| `failed`      | Slots that errored or never answered inside `--turn-timeout`                                                              | lower  |

The two throughput columns pull in opposite directions, and reading only one of
them is the mistake this phase exists to prevent:

- **`agg_tok/s` goes up** as slots are added — until it plateaus.
- **`slot_tok/s` goes down**, always. Every caller is now sharing memory bandwidth.

#### Check `overlap` before you believe anything else

Firing N requests at once is not the same as a server _running_ N at once, and the
difference is invisible in throughput. A backend that queues serves them strictly
one after another — yet its `agg_tok/s` **still rises with N**, because one
request's prompt processing overlaps the decode of whoever is ahead in the queue.
Read the scaling curve off that and you will conclude your box batches beautifully
when it has never batched anything.

`overlap` is the mean number of slots mid-stream at the same moment. Close to
`slots` is real parallelism; close to `1.0` is a queue in a costume. Here is the
same sweep against a batching server and a queueing one:

```
    slots  overlap   agg_tok/s   slot_tok/s   ttft_ms   max_ttft_ms
        1      1.0        75.3        185.4     194.6         194.6
        4      3.3       126.5         49.3     259.4         332.6   <- batching

        1      1.0        49.6        184.9     358.9         358.9
        4      1.0        60.1        186.6     875.3        1474.2   <- queueing
```

The queueing run gives itself away three times over: `overlap` stays at 1.0,
`slot_tok/s` **does not drop** (nobody is competing for bandwidth), and
`max_ttft_ms` explodes because the last request waited for all three ahead of it.
Meanwhile `agg_tok/s` went _up_, which is the whole trap. When `overlap` collapses
like that the benchmark says so in capitals and names the fix.

The same thing looks obvious on the live dashboard once you know to watch for it:
real parallelism shows every slot's token count climbing together, while a queue
leaves them parked on `sending` and lights them up one at a time.

The **knee** is the widest level still converting added slots into throughput at
70% of linear or better. Past it you are mostly buying queueing: aggregate barely
moves, `max_ttft_ms` climbs, and every individual agent feels slower. That is the
number to size a fleet of local agents against.

One asymmetry to expect: at one slot, `agg_tok/s` reads _lower_ than `slot_tok/s`.
That is not a bug. Aggregate counts prompt processing and the request round trip
inside its window; per-slot decode explicitly excludes both.

**The server has to have been started for it.** A concurrency level wider than the
backend's parallel-request setting does not fail loudly — the surplus just queues,
and the row then measures the queue instead of the hardware. Set it first:

| Backend   | Setting                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| llama.cpp | `llama-server -np N`. Note `-c` is the **total** context, split across slots — context per slot is `-c / -np`        |
| Ollama    | `OLLAMA_NUM_PARALLEL=N`                                                                                              |
| vLLM      | `--max-num-seqs` (already high by default)                                                                           |
| LM Studio | Serves concurrent requests from a loaded model; if a level shows `failed` slots, check the server's request settings |

Watch for `failed` slots and for `eff` collapsing between one level and the next —
both usually mean the sweep went wider than the server was configured for, not
that the hardware ran out.

### Gallery — N agents, N _different_ jobs

The sweep sends N copies of one prompt because that is what isolates the variable.
The gallery does the opposite: each slot gets distinct work, and the output is kept
and rendered into the report. This is the part taken from the [Gemma cookbook's
concurrent demo](https://github.com/google-gemma/cookbook/tree/main/apps/concurrent) —
worth having because "10 agents at once" is a claim you want to _look_ at, not just
read a tok/s figure for.

```bash
node bench.mjs --phases concurrent --scenario svg       --topic "deep sea life" --tasks 9
node bench.mjs --phases concurrent --scenario ascii     --topic "animals"
node bench.mjs --phases concurrent --scenario code      --topic "binary search"
node bench.mjs --phases concurrent --scenario translate --topic "Local models are fast enough now."
```

| Scenario    | Each slot produces                    | Rendered as                |
| ----------- | ------------------------------------- | -------------------------- |
| `svg`       | One `<svg>` icon                      | The drawing itself, inline |
| `ascii`     | ASCII art                             | Monospace, as sent         |
| `code`      | One implementation, one language each | Syntax-plain source        |
| `translate` | The topic sentence in one language    | The text                   |

A planner call goes first: the model is asked for `--tasks` distinct instructions
as a JSON array. Whether it manages that is itself a result — small quants often
cannot — and the run says so rather than hiding it, falling back to generated
instructions for whatever it failed to plan.

`--tasks` may exceed `--concurrency`: slots pull from one shared queue, so 20 tasks
across 8 slots keeps all 8 busy rather than running three ragged batches. The
widest `--concurrency` level is used as the pool size; a gallery is not a sweep.

Model output goes straight into a file you open in a browser, so SVGs are stripped
of `<script>`, event-handler attributes and `javascript:` URLs before they land.

### The live view

While a level runs, each slot gets a row that updates in place — state, tokens out,
live tok/s, elapsed, a progress bar against the token budget — over a running
aggregate. It is erased when the level ends, because the table printed underneath
it is the record and four levels of leftover dashboards are not.

The Gemma cookbook app does this by opening a grid of macOS Terminal windows over
AppleScript. That cannot travel here: `bench.mjs` has to keep working under plain
`node` on Linux and Windows and ship as a static binary. Same idea, one terminal.

It is TTY-gated, so piping to a file or running in CI produces plain output with no
escape codes. `--no-live` switches it off on a TTY too.

### Agentic coding — can it actually _drive tools_

Not a completion benchmark. The model is given five tools (`plan`, `write_file`,
`list_files`, `read_file`, `finish`) and asked to build a three-file tip
calculator: plan first, write each file, then call `finish`. The loop runs until
it finishes or hits `--max-turns`.

This measures the things that decide whether a local model is usable as a coding
agent, none of which show up in tok/s:

| Column                | Meaning                                                                                                                                                            | Better |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `turn`                | Which round trip. Each turn is one model message plus the tool result fed back                                                                                     | —      |
| `ctx_tok`             | Prompt tokens _this_ turn — i.e. the whole transcript so far. Watch it grow; this is what makes agent loops expensive                                              | —      |
| `first_tok_ms`        | Latency before the model starts responding. Rises with `ctx_tok`, because every turn re-prefills the transcript                                                    | lower  |
| `out_tok`             | Tokens the model produced this turn                                                                                                                                | —      |
| `think_tok`           | Reasoning tokens inside `out_tok`. If this equals `out_tok` and the action is `no tool call`, the model thought until it ran out of budget — raise `--turn-tokens` | lower  |
| `out_tok/s`           | Decode speed, as in the generation phase — including its single-chunk fallback, which Ollama's tool calls routinely trigger                                        | higher |
| `took_s` / `took_min` | Wall-clock for that turn, end to end, in both seconds and minutes                                                                                                  | lower  |
| `action`              | The tool call(s) the turn produced, or `no tool call`                                                                                                              | —      |

And in the summary:

| Field                             | Meaning                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finished`                        | Did it call `finish`, or run into the turn cap? The single most important line                                                                                                         |
| `wall_clock_s` / `wall_clock_min` | End-to-end in both seconds and minutes, the number you actually feel                                                                                                                   |
| `tool_calls`                      | Total, with a breakdown of **malformed** (arguments were not valid JSON) and **unknown** (invented a tool). Non-zero counts here are the usual reason a local model cannot be an agent |
| `turns_without_a_tool_call`       | Turns that produced prose but no action, and how many of those ran out of output budget mid-thought                                                                                    |
| `stalled_turns`                   | Turns that never returned inside `--turn-timeout`. The run stops at the first one                                                                                                      |
| `files_written`                   | What landed, by name                                                                                                                                                                   |
| `plan_steps`                      | Step count, or `never called plan` if it ignored the instruction to plan first                                                                                                         |
| `input_tok_total`                 | Summed `ctx_tok` — the re-prefill tax of the whole conversation                                                                                                                        |
| `decode_tok_s_median`             | Median across turns, so a slow late turn does not hide behind a fast first one                                                                                                         |

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

  | Lever                                            | reasoning_tok | Result                              |
  | ------------------------------------------------ | ------------- | ----------------------------------- |
  | `/no_think` in the prompt                        | 100           | works, but thinking is only reduced |
  | `chat_template_kwargs: {enable_thinking: false}` | 156           | ignored in this build               |
  | `reasoning_effort: 'none'`                       | **0**         | thinking off, tool call in 5.8 s    |

The spiral is not always fatal, though. On the PC runs below, thinking was left
**on** and the model _did_ recover: turn 1 burned the full 4,096-token budget on
4,080 thinking tokens and produced no tool call, then turns 2-6 planned, wrote
three files and called `finish` with barely any thinking at all (16, 9, 9, 34,
13 tokens). The cost was one dead turn — 116.0 s, 57% of that run's entire
agentic wall-clock — rather than the whole run. It came out the same way twice:
**4,080 thinking tokens on turn 1 in both PC runs**, 117.2 s and 116.0 s.

So the failure mode is better described as _the first turn is where it spirals_:
with an empty transcript and an open-ended task it tries to design everything at
once, and once a plan exists in the transcript it stops. Whether it escapes on
its own is luck; `--reasoning none` removes the coin flip.

So the honest headline is that **decode speed was never the bottleneck for
agentic use on this setup** — thinking discipline was. That is exactly the kind
of thing a tok/s benchmark cannot tell you.

Prompt caching is deliberately _not_ defeated in this phase, unlike the prefill
test. Real agent loops re-send a growing transcript and benefit from the cache;
suppressing it would measure something nobody experiences.

Token counts come from the server's `usage` block, not from a local tokenizer,
so they are exact. If a backend omits `usage`, output tokens fall back to a
stream-chunk count and the run is labelled approximate.

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
  _Time to first token_ with `ttft_ms · TTFT` beneath it, so the report is
  readable by someone who has never seen the CLI.
- **A per-metric glossary under each table** — what the number measures, its
  unit, and whether higher or lower is better.
- **Per-field explanations of the agentic summary**, including why `finished` is
  the line that matters most.
- **A time-taken table** with each phase's share of the whole run.
- **A live `<iframe>` of the app the model built**, next to every generated file
  in a foldable block.
- **The gallery**, when a `--scenario` ran: what every slot produced, rendered —
  the SVGs drawn, the ASCII art in monospace, the code as code — each captioned
  with its own tokens, decode rate and wall clock, and the instruction it was
  given in a foldable block underneath.

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
  rate _down_ — earlier versions of this README said inflated, which was backwards.
  The floor is now measured and subtracted; the raw column is kept only so older
  runs stay comparable.
- **Medians, not means, for a reason.** Backends cache prompts. A single cached
  run can report an order-of-magnitude-too-high prefill rate; the median rejects
  it — and `spread` tells you it happened, which a mean would have quietly
  absorbed. Keep `--runs` at 3 or more, and inspect `--json` when `spread` is
  large. Prompt caching is _mostly_ defeated (see below) but not perfectly.
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
  run prefixes a unique nonce _first_, so no prefix is ever shared. The nonce is
  seeded per **process**, not just per run — an in-run counter restarts at zero
  every invocation, so back-to-back runs would send byte-identical prompts and be
  served from the backend's _on-disk_ cache. That mistake reported 4,898 tok/s at
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
  SSE chunk — both now fixed; see [what the first run broke](results.md#what-the-first-run-broke).
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
  `report.html` iframe is there so _you_ judge the output. Scoring correctness
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

## Prior art

The prefill/decode split and the agentic phase are this benchmark's own, but four
of the measurements above came from reading
[eugr/llama-benchy](https://github.com/eugr/llama-benchy), which brings
llama-bench-style numbers to OpenAI-compatible endpoints: measuring at context
depth, subtracting an estimated latency baseline, reporting run-to-run variance
next to the central number, and reading peak throughput off a one-second window.

The concurrency phase and its gallery come from the [Gemma cookbook's concurrent
demo](https://github.com/google-gemma/cookbook/tree/main/apps/concurrent), which
runs N Gemma instances against one `llama-server` and shows them working in a grid
of Terminal windows. Taken: the slot model, the live view, the model-planned task
list, and the idea that concurrent output is worth _rendering_ rather than only
counting. Not taken: the AppleScript window grid, which is macOS-only and cannot
live in a file whose whole contract is running anywhere `node` does — one terminal
with rows repainted in place does the same job.

Concurrency was until recently listed here as deliberately out of scope, on the
grounds that it is a serving-capacity question and this is a single-user tool. That
was wrong in one specific way: the single user in question increasingly runs
several agents at once, which is a serving-capacity question wearing a single-user
hat. Hence the phase.

Deliberately not taken from llama-benchy: local HuggingFace tokenizers
(server-reported `usage` is exact and needs no dependency), and prefix-cache
measurement, which is the direct opposite of what the nonce prefixing here exists
to defeat.

Its remaining idea worth revisiting is sourcing prompts from a real book rather
than a repeated filler phrase, so that speculative decoding and MTP are measured
against text they cannot trivially draft. That is a real effect, but it costs the
single-file property this tool is distributed on, and it has not yet been shown to
move the numbers on any stack measured here — so it stays unbought until an
MTP-enabled A/B says otherwise.
