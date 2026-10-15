# Benchmark records

`comparison.json` contains the five configurations plotted in the root README.
Four historical rows are transcribed from that README's post-TTFT-fix results;
their original raw samples are not reconstructed. The LFM2.5 row comes from the
archived CLI samples below. Values compare complete model/backend stacks, with
different tokenizers, quantization, reasoning settings and server versions.

## Ryzen / RX 7900 XT · LFM2.5 24B · 2026-10-15

- [cli.json](2026-10-15-ryzen-lfm2.5-24b/cli.json): complete four-phase measurements,
  including individual prefill/generation samples, concurrency requests and agentic turns.
- [studio.json](2026-10-15-ryzen-lfm2.5-24b/studio.json): completed Studio serving
  performance run, configuration, backend/model snapshot, client hardware and measurements.
- [metadata.json](2026-10-15-ryzen-lfm2.5-24b/metadata.json): Windows host CPU/GPU/RAM,
  WSL client limits, Ollama version/model digest and reproduction command.
- [gallery-default.json](2026-10-15-ryzen-lfm2.5-24b/gallery-default.json) and
  [gallery-reasoning-none.json](2026-10-15-ryzen-lfm2.5-24b/gallery-reasoning-none.json):
  nine SVG tasks with nine client slots. Both have zero planned instructions,
  zero visible characters for every task, and streaming overlap 1.0. All requests
  exhausted their 900-token budgets. Token production does not establish an SVG result.
- [verified-task-readiness.json](2026-10-15-ryzen-lfm2.5-24b/verified-task-readiness.json)
  and [verified-task-status.json](2026-10-15-ryzen-lfm2.5-24b/verified-task-status.json):
  completed Docker setup and graded outcomes: **1 passed, 2 failed, 3/3 graded**,
  zero setup or execution errors. The `*-before.json` files retain the earlier
  blocked setup state, before explicit approval enabled Ubuntu integration.
- [verified.json](2026-10-15-ryzen-lfm2.5-24b/verified.json): full Studio verified run,
  including fixed budgets, task hashes, backend snapshot and per-task diagnostics.
- [verified/](2026-10-15-ryzen-lfm2.5-24b/verified/): each task's Harbor result,
  ATIF agent trajectory, saved artifacts and independent verifier output/reward.
- [verified-studio.png](2026-10-15-ryzen-lfm2.5-24b/verified-studio.png): completed
  run displayed in the Studio browser UI.
- [verified-ollama-runtime.json](2026-10-15-ryzen-lfm2.5-24b/verified-ollama-runtime.json):
  Ollama's loaded-model metadata captured during the verified suite.

Prefill/generation use three samples per row; each speed run has one agentic attempt.
Only the new four-phase runs include concurrency, so compare phase measurements
with the older three-phase runs rather than total runtime. Agentic completion is
self-reported tool-loop completion; functional correctness was not graded in that
phase. The separate Studio verified suite below grades its saved artifacts.

The original HTML reports and generated apps remain under `out/`, which is
gitignored. Studio is available at `http://localhost:4310`; its run history includes
`49efc877-e36a-4153-9346-8cade0d3cfb5`.
The verified-task run is `44898420-865e-40ce-bc43-936de4981ebe`.

## Verified task outcomes

| Task | Outcome | Agent seconds | Diagnostic |
| --- | --- | ---: | --- |
| money-split | Pass | 26.224 | Independent checks passed. |
| csv-parser | Fail | 42.769 | Output length limit while thinking; no write was made. |
| ticket-triage | Fail | 25.563 | Two wrong department labels in the saved JSON. |

Run wall time: 170.114 seconds, including setup and verification. One attempt per
task, 24 turns, 4,096 tokens per turn, 600 seconds per task, temperature zero,
reasoning requested off. All three attempts graded; success is 1/3. No retries or
budget changes. The CSV failure is a graded artifact failure with an output-budget
diagnostic; the ticket task recovered from a missing Python command but still
saved wrong classifications. Neither is a Docker/Harbor setup or request error.

The three-task fixture suite is an integration check, not a general leaderboard.
Older models in the throughput comparison have no verified-task scores here.

## Output-budget follow-ups

The 8,192-token / 900-second rerun is archived in
[verified-8192.json](2026-10-15-ryzen-lfm2.5-24b/verified-8192.json) with its
[trajectories, artifacts and verifier outputs](2026-10-15-ryzen-lfm2.5-24b/verified-8192/).
Studio run: `a6ffd6e4-fdb9-4ac1-8d64-4a9797dbcec1`.
The 16,384-token / 900-second run is archived in
[verified-16384.json](2026-10-15-ryzen-lfm2.5-24b/verified-16384.json), with
[trajectories and saved artifacts](2026-10-15-ryzen-lfm2.5-24b/verified-16384/).
Studio run: `de9b545f-7790-4193-a5cf-ff0a638c2a91`.
Completed UI captures: [8,192 tokens](2026-10-15-ryzen-lfm2.5-24b/verified-8192-studio.png)
and [16,384 tokens](2026-10-15-ryzen-lfm2.5-24b/verified-16384-studio.png).

| Output budget · task deadline | money-split | csv-parser | ticket-triage | Passed / graded | Wall seconds |
| --- | --- | --- | --- | ---: | ---: |
| 4,096 · 600 s | Pass, 26.224 s | Fail, 42.769 s | Fail, 25.563 s | 1/3 | 170.114 |
| 8,192 · 900 s | Pass, 33.011 s | Fail, 94.456 s | Fail, 22.680 s | 1/3 | 218.214 |
| 16,384 · 900 s | Pass, 30.169 s | Turn-cap error, ungraded, 726.010 s | Fail, 24.110 s | 1/2, plus 1 ungraded | 836.356 |

At 8,192 tokens, CSV again stopped at the output length limit before editing.
Ticket routing fixed `t4` but still misclassified `t5` as `other` instead of
`billing`. Money splitting recovered from a typo in its own local test and passed
the independent checks. There were no setup or execution errors.

At 16,384 tokens, CSV first wrote code after 14,850 output tokens, then reached
the 24-turn cap after multiple unsuccessful revisions. The adapter raised
`Local model request failed: This operation was aborted`, so Harbor did not run
the formal verifier. The trial has `reward: null`, `budgetExhausted: true` and
`status: error`; it is not a graded failure or pass. Ticket routing still labeled
`t5` as `other` instead of `billing`. There was one execution error and no setup errors.

The raw Studio success rate of 50% excludes the ungraded CSV trial: **one passed,
one failed, one ungraded/error** across three requested tasks. It must not be
compared directly with 33.3% from the fully graded runs. The 16,384-token attempt
used 149,666 input and 60,997 output tokens in total.

A [separate CSV artifact diagnostic](2026-10-15-ryzen-lfm2.5-24b/verified-16384/csv-parser/artifact-check/result.json)
ran the unchanged verifier checks against the saved file in a read-only,
no-network container using the pinned Node image. It failed the quoted-comma case;
[stderr](2026-10-15-ryzen-lfm2.5-24b/verified-16384/csv-parser/artifact-check/stderr.txt)
records the assertion. This does not alter the original run or supply a formal
Studio grade. The inspected [model template](2026-10-15-ryzen-lfm2.5-24b/ollama-template.jinja)
is also archived; its generation prefix opens `<think>` without a thinking toggle
in that block. No server template was modified for these attempts.

[verified-budget-comparison.json](verified-budget-comparison.json) records the
changed settings and original run IDs, configurations, grades and timing inputs
for [the comparison chart](verified-budget-comparison.svg). The model digest and
task hashes match; the first three runs share harness versions, while the 32k
follow-up uses adapter revision 2. Each configuration has one fresh attempt
per task, with no automatic retries. These small samples do not establish
reliability or isolate budget effects from run-to-run variation.

The gallery reports are `out/run-2026-10-15T17-26-08/report.html` (default) and
`out/run-2026-10-15T17-32-31/report.html` (`--reasoning none`). The retry followed
an Ollama app restart after its endpoint stopped responding; it is a separate run,
not a continuation of the original server session. The full-suite comparison uses
the earlier uninterrupted CLI and Studio runs.

## Adapter revision 2 validation

The full **32,768-token / 900-second / 24-turn** suite is archived in
[verified-32768.json](2026-10-15-ryzen-lfm2.5-24b/verified-32768.json) and
[per-task evidence](2026-10-15-ryzen-lfm2.5-24b/verified-32768/).
[Completed Studio screenshot](2026-10-15-ryzen-lfm2.5-24b/verified-32768-studio.png).
Run `6b5656a2-4e3a-4062-928d-9c74354affcb` finished in **762.350 seconds**:
bill splitting passed (27.383 s), CSV failed (647.690 s), and ticket routing
failed (19.848 s). All three were graded, with zero setup or execution errors.
CSV finished naturally after 12 turns, dropping a trailing empty field; it hit
neither the output nor turn limit. Ticket routing misclassified `t4` and `t5` as
`other`, instead of `sales` and `billing`. Total output was 49,091 tokens,
44,438 from CSV. Model template, instructions and graders were unchanged.
Adapter 2 changes reasoning forwarding and turn-cap grading, so this row is a
separate harness experiment rather than a pure budget-only comparison.

[Validation evidence](2026-10-15-ryzen-lfm2.5-24b/adapter-2-validation/)
contains the pinned Pi runtime checks and a real Docker/Harbor turn-cap trial.
The mock runtime exercises a cap after two writes, natural completion on the
last allowed turn, and a genuine provider error. Artifacts survive the cap;
the provider error remains observable. The real trial deliberately permits only
one turn and 256 output tokens: its incomplete artifact receives a formal failed
grade, with zero execution errors. This is harness validation and is excluded
from model-quality comparisons.

[Direct reasoning-control probes](2026-10-15-ryzen-lfm2.5-24b/reasoning-control-diagnostic.json)
returned thinking with both native `think: false` and compatible
`reasoning_effort: none`, even without Pi. Each probe was capped at 64 output
tokens; this establishes that thinking started despite the off request. The
model template was left unchanged. Studio now records the forwarded reasoning
request and observed thinking, and allows up to 32,768 output tokens per turn.

## Regenerate charts

Use Python 3 with Matplotlib 3.10.8 in an isolated environment, then run:

```bash
python scripts/plot-results.py
```

This reads the archived JSON and writes `comparison.svg`,
`ryzen-lfm2.5-concurrency.svg` and `verified-budget-comparison.svg`. The charts use zero-based axes and distinguish
token throughput from elapsed time. No inference is required to regenerate them.
