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

## License

MIT — see [LICENSE](LICENSE).
