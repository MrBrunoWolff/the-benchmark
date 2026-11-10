# the-benchmark

A local LLM benchmark for measuring prompt processing, generation, concurrent requests and tool calls, with an optional Studio for independently graded coding tasks.

[![npm](https://img.shields.io/npm/v/the-benchmark?style=flat-square)](https://www.npmjs.com/package/the-benchmark)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

## Quick start

Load a model in Ollama or enable LM Studio’s local server, then run:

```sh
npx -y the-benchmark
# Or with Bun:
bunx the-benchmark
```

The CLI requires Node.js 18 or later, or Bun 1.4 or later. It detects a running local backend; pass `--target ollama` or `--target lmstudio` for unattended runs when both are available. Other OpenAI-compatible endpoints can be selected explicitly:

```sh
npx -y the-benchmark --url http://localhost:8080
npx -y the-benchmark --phases concurrent --concurrency 1,2,4,8
npx -y the-benchmark --phases agentic
```

For the local UI:

```sh
npx -y the-benchmark studio
```

Open [localhost:4310](http://localhost:4310). Studio requires Node.js 22.22 or later and npm; its first launch installs the optional UI. Independently verified tasks also require Docker and internet access for initial runtime setup. Native Linux and Windows verified-task execution are not yet validated; see the [Studio guide](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/studio.md).

Both modes work directly from the package, without cloning or a global install:

| Mode | npm | Bun |
| --- | --- | --- |
| CLI only | `npx -y the-benchmark` | `bunx the-benchmark` |
| Local UI | `npx -y the-benchmark studio` | `bunx the-benchmark studio` |
| Help | `npx -y the-benchmark --help` | `bunx the-benchmark --help` |

In Studio, **Compare models** charts saved verified-task runs by task. Select one
run per model; selecting a newer attempt replaces that model's previous selection.
The charts show passes out of all planned attempts and median time for passing
attempts, with configuration differences and errors visible alongside the results.

## Features

- Dependency-free CLI for Ollama, LM Studio and compatible servers.
- Context-depth and concurrency sweeps, streaming metrics and HTML/JSON reports.
- A tool-calling smoke test with a virtual filesystem.
- Optional Studio with run history, comparison and separately graded task artifacts.
- Decision-model comparisons for Jev and Cloudflare Clef.

The three bundled verified tasks are an integration suite, not a broad coding leaderboard. Compare runs with the same tasks, budgets, server configuration and hardware.

## Scripts

For development, clone the repository and install with `bun install --frozen-lockfile`. These commands run from the checkout:

| Command                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `bun run bench`        | Run the default CLI benchmark                   |
| `bun run concurrent`   | Run a concurrency sweep                         |
| `bun run agentic`      | Run the tool-calling smoke test                 |
| `bun run studio:setup` | Install and build the optional Studio UI        |
| `bun run studio`       | Start Studio                                    |
| `bun run studio:test`  | Test the Studio runner and API                  |
| `bun run test`         | Run CLI regression tests                        |
| `bun run check:ci`     | Run the complete repository validation contract |

## Development

See the [CLI reference](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/cli.md), [Studio guide](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/studio.md), [decision-model guide](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/decision-models.md) and [recorded results](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/results.md). The [column naming proposal](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/cli-column-proposal.md) is a design discussion, not current CLI behavior.

For maintainer validation, see [QUALITY.md](https://github.com/MrBrunoWolff/the-benchmark/blob/main/QUALITY.md). Bun’s release-age policy can select an older eligible CLI; pin a version to check it explicitly, wait for it to age, or use npm. Reference guides are linked from GitHub so they remain accessible from the npm package.

## Latest recorded run

On 2026-11-10, LFM2.5-24B-A2B Q4_K_M on LM Studio, with a 38,656-token
loaded context and a Ryzen 7 5800X3D WSL client, generated a median **164.2
tokens/s** at depth 0 (three samples; all output tokens were reported as
thinking). Estimated prefill was 489.4 tokens/s for a 9,131-token prompt. Two
concurrent requests achieved 183.5 aggregate tokens/s; four had a 112-second
median time to first token, and all eight requests at the next level timed out
after 180 seconds. These are measurements of this server setup, not general
model limits.

The tool-calling smoke test finished in five turns, without functional grading;
its first turn waited 42 seconds for a token after the concurrency sweep. A
separate [verified task run](https://github.com/MrBrunoWolff/the-benchmark/blob/main/results/2026-11-10-lmstudio-lfm2.5-24b/verified-8192.json)
passed **1/3 tasks**: bill splitting passed, CSV parsing failed after hitting
the 8,192-token output limit, and ticket triage misclassified one ticket.
All three were graded, with no setup or execution errors. The run used one
attempt per task, 24 turns, a 900-second deadline, and reasoning requested off;
thinking was still observed. The prior Ollama run passed 1/3 at 32k output
tokens per turn. See the [new raw CLI
results](https://github.com/MrBrunoWolff/the-benchmark/blob/main/results/2026-11-10-lmstudio-lfm2.5-24b/cli-38656-context.json), the [earlier 8,192-context run](https://github.com/MrBrunoWolff/the-benchmark/blob/main/results/2026-11-10-lmstudio-lfm2.5-24b/cli.json), [results and budget
comparisons](https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/results.md),
and [archived samples, artifacts and charts](https://github.com/MrBrunoWolff/the-benchmark/blob/main/results/README.md).

For the default CLI prefill sizes, load a context larger than 8,192 tokens (for
example, 32,768) to leave room for the prompt and output. Match context, hardware,
backend settings and task budgets when comparing runs; larger contexts can also
change memory use and concurrency.

## License

MIT — see [LICENSE](LICENSE).
