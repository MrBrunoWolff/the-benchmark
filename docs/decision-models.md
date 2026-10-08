# Decision model benchmarks

[Project overview](../README.md)

## System One: local models vs Jev

Run from this checkout (this addition has not been published):

```bash
# Edit .env.local and set TYPESAFE_API_KEY=your-key-here
node bench.mjs --phases system-one --target lmstudio --runs 1
# Ollama, or a custom OpenAI-compatible server:
node bench.mjs --phases system-one --target ollama --model your-local-model --reasoning none
node bench.mjs --phases system-one --url http://localhost:8080 --model your-local-model
# Either provider on its own:
node bench.mjs --phases system-one --system-one-providers local
node bench.mjs --phases system-one --system-one-providers jev
```

The phase defaults to **both** providers. The key is read from `TYPESAFE_API_KEY`
in your environment, then `.env.local` in the current working directory. Copy
`.env.example` if that file does not exist. `--env-file /path/to/file` selects a
different key file. No dotenv package is needed; the reader supports a plain or
quoted single-line key and does not expand variables. The key is sent only to
Jev, never to the local model or the HTML/JSON report.

[TypeSafe's API](https://docs.typesafe.ai/api) uses
`POST https://api.typesafe.ai/v1/systemone`, bearer authentication, and
`model: "jev-latest"`. It accepts `state` plus typed `questions`, returning
`answers`. It is a hosted decision API, not an OpenAI chat endpoint:

| Primitive | What it answers                                          | Benchmark measure                        |
| --------- | -------------------------------------------------------- | ---------------------------------------- |
| Choice    | One of the named alternatives                            | Exact match                              |
| Score     | A position along descriptive levels, including fractions | Absolute error; correct within 0.5 level |
| Noul      | Probability that a yes/no statement is true              | Accuracy at 0.5; Brier score             |

The built-in, non-game suite has four synthetic support tickets: routing,
operational impact, and refund intent, all asked together. Both providers receive
**identical states, instructions, and criteria**. Expected answers stay in the
benchmark. Local models generate the minimal JSON answer through chat completions;
Jev returns native typed answers. Local Noul values are generated estimates, not
native calibrated probabilities. This is a small integration/latency check, not a
representative quality leaderboard.

Each state is sent once per provider per repeat: `--runs 1` makes **4 Jev calls**;
the default `--runs 3` makes 12. Calls are sequential and provider order alternates.
There are no retries or warmup calls for this phase; first-use overhead is included,
and repeats may benefit from provider caching. Jev latency includes your Internet
round trip; local latency includes JSON generation and parsing. Compare complete
answer latency, valid-answer rate, and correctness, not tokens/second.

The console and HTML report show median/p95 latency for **fully valid responses**,
failures, validity, accuracy, Score MAE, and Noul Brier. Invalid/missing answers count
as wrong; MAE/Brier use only valid numeric answers. With so few samples, p95 will
usually be the slowest sample. Any failed request or invalid answer produces a
nonzero exit status but still saves both providers' results. HTTP bodies are not
printed. Results, usage counts, cases and expected answers are saved beside the
HTML report as `out/run-*/system-one.json`; `--json` also prints them.

Additional options: `--jev-model` (default `jev-latest`), `--system-one-tokens`
(local output budget, default 1024), and `--turn-timeout` (seconds per request,
default 180). `--model` always selects the **local** model. Thinking models may need
`--reasoning none` to finish valid JSON within that budget. `--jev-url` overrides
the Jev origin for testing; use only a trusted origin because it receives your key.
Only HTTPS or loopback HTTP is accepted, and redirects are rejected.

For your own non-game tasks, `--system-one-cases path.json` accepts
`{ "name": "my-suite", "questions": { ... }, "cases": [
{ "id": "case-1", "state": "...", "expected": { ... } } ] }`.
Questions use TypeSafe's Choice/Score/Noul shapes; expected values are respectively
option strings, numbers, or booleans. Every case must label every question. Custom
states are sent to the selected providers and included in the local report.

## Clef decision models

Compare providers using the same states and questions:

```sh
CLOUDFLARE_ACCOUNT_ID=your-account-id CLOUDFLARE_API_TOKEN=your-token \
  node bench.mjs --phases system-one --system-one-providers jev,clef,clef-flash
```

Keep credentials in your environment or `.env.local` (also supports `--env-file`).
The Jev comparison still requires `TYPESAFE_API_KEY`. Use `--system-one-providers clef,clef-flash`
for Cloudflare only. `--clef-url` overrides the REST origin for compatible servers/mocks;
it requires HTTPS except on loopback. Existing defaults and Jev options are unchanged.

Clef accepts the existing Jev `state`/`questions` schema and returns the same typed
answers. REST responses are unwrapped from Cloudflare’s `result` envelope.
See [Clef docs](https://developers.cloudflare.com/workers-ai/models/clef/) and
[Clef-flash docs](https://developers.cloudflare.com/workers-ai/models/clef-flash/).
