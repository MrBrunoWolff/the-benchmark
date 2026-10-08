# CLI column naming proposal

[Project overview](../README.md)

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

| Now                    | Proposed       | Why                                                                                               |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `prompt_tok`           | `input_tok`    | Pairs with `out_tok`; "prompt" also names the flag that sets it                                   |
| `ttft_ms` (prefill)    | `prefill_ms`   | In that section it _is_ the prefill time — say so instead of making the reader derive it          |
| `prefill_tok/s`        | `input_tok/s`  | Names the thing being counted, and matches the column it derives from                             |
| `ttft_ms` (generation) | `first_tok_ms` | Same quantity, different meaning here — it is the latency floor, so stop reusing the prefill name |
| `gen_tok/s`            | `out_tok/s`    | Consistent with `out_tok`, and with the agentic table                                             |

Renaming these is a breaking change for anyone parsing the output, which is why
they are listed rather than applied.
