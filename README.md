# the-benchmark

Minimal local-LLM server benchmark. One code path, zero dependencies — only the
base URL changes between backends.

Works against any OpenAI-compatible `/v1/chat/completions` endpoint: LM Studio,
Ollama, llama.cpp server, vLLM.

## Usage

Load a model in your backend, then:

```bash
bun run lmstudio          # http://localhost:1234
bun run ollama            # http://localhost:11434
node bench.mjs --url http://localhost:8080   # anything else
```

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
| `--json` | off | Also dump raw per-run results as JSON |

## Metrics

**Prompt processing (prefill)** — `max_tokens=1` at each prompt size.
- `ttft_ms` — time to first token, i.e. the prefill cost
- `prefill_tok/s` — `prompt_tokens / ttft`

**Generation** — short prompt, `max_tokens=--gen-tokens`.
- `gen_tok/s` — `(out_tokens - 1) / (total - ttft)`, so prefill is excluded
- `reasoning_tok` — how much of the output was thinking, when reported

Token counts come from the server's `usage` block, not from a local tokenizer,
so they are exact. If a backend omits `usage`, output tokens fall back to a
stream-chunk count and the run is labelled approximate.

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

- **Prompt caching is defeated on purpose.** Backends cache prompt prefixes,
  which would turn the prefill test into a cache-hit test. Every run prefixes a
  unique nonce *first*, so no prefix is ever shared. This is effective but not
  airtight — occasional cache hits still slip through, hence the median.
- **A warmup run precedes measurement** so JIT model loading is not counted in
  the first result.
- **`temperature: 0`** for run-to-run stability.
- **Cold-load time is not measured** — that needs an unload between runs, which
  has no portable API across backends. Restart the backend and watch the warmup
  if you care about it.
- **The Ollama path is written against the same OpenAI-compatible contract but
  has not been verified on a live Ollama server.** It falls back to counting
  stream chunks if `usage` is absent, as older builds omit it.

## Sample results

Ryzen 7 5800X3D · Radeon RX 7900 XT 20 GB · 31 GB RAM · LM Studio on Vulkan,
`n_gpu_layers=56` · `qwen/qwen3.8-27b` Q4_K_M @ 80,384 ctx

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

Prefill settles at **~460 tok/s** once prompts are large enough to saturate the
GPU (2k and 8k agree closely; the 8k runs varied by under 1%). Generation holds
**~13 tok/s** across runs. The 316-token row is the latency-floor artifact
described above — ignore it.

## License

MIT — see [LICENSE](LICENSE).
