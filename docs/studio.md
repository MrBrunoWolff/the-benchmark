# Benchmark Studio

[Project overview](../README.md)

## Local benchmark Studio (0.5)

The optional Studio adds a local UI for independently verified coding and file-based
agent tasks. It also runs the existing prefill, generation, concurrency, agentic,
and System One phases. The original CLI remains dependency-free.

```bash
bunx the-benchmark studio
# Or:
npx -y the-benchmark studio
# Open http://localhost:4310
```

Studio requires Node 22.22+ (Node 24 recommended), npm, and a local model server.
The first launch installs and builds the optional UI in
`~/.cache/the-benchmark/<source-hash>/`; subsequent launches reuse it. No checkout,
global installation, Python installation, or manual setup command is needed.

For **verified tasks**, start Docker Desktop (or the Docker daemon), select your
model and tasks in the UI, and click **Run benchmark**. Studio automatically
installs a pinned, checksum-verified uv binary, downloads Python 3.12, installs
Harbor, and builds the pinned Pi image in its own local runtime. Setup progress
and errors appear in the UI, and a failed setup can be retried by clicking Run.
Initial setup needs internet access and may take several minutes. The first task
run also builds Harbor's network policy sidecar and verifier images; subsequent
inference and grading use local services and cached container images.
Serving performance benchmarks do not require Docker.

Automatic task setup supports macOS and Linux on x64/ARM64. Verified tasks are
currently tested on macOS with Docker Desktop; the host bridge must resolve
`host.docker.internal`. Native Linux and Windows task execution are not yet validated.

```bash
bunx the-benchmark studio --port 4321 --data-dir ./benchmark-results
bunx the-benchmark studio --setup # optionally prepare verified tasks before opening the UI
```

Runs default to `out/studio` in the directory where you launch the command.
`--data-dir` (or `BENCHMARK_DATA_DIR`) selects persistent storage independent of the
UI cache. `BENCHMARK_CACHE_DIR` overrides the optional runtime cache location.
The `ui` subcommand and `--ui` are aliases for `studio`.

Development from a checkout remains available:

```bash
git clone https://github.com/MrBrunoWolff/the-benchmark.git
cd the-benchmark
npm run studio:setup
npm run studio
```

Start Ollama or load a model in LM Studio and enable its local server. In Studio,
choose the endpoint, refresh models, and select your downloaded model.
Ollama defaults to `http://localhost:11434`, LM Studio to `http://localhost:1234`.
Future downloaded models use the same adapter; models must support OpenAI-compatible
streaming chat and native tool calls. No cloud credentials are needed. Set the
context window to match the server, and keep output tokens below that window.
Reasoning settings are requests to the server; support depends on the model/backend.

The layers have separate jobs:

| Layer                        | Role                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Agent-Native actions + React | Local setup, progress, histories, comparisons, file inspection and JSON exports        |
| Harbor 0.24.0                | Fresh task environments, attempts, deadlines, artifact collection and separate grading |
| Pi 1.0.4                     | Agent loop with real read, write, edit and bash tools                                  |
| Ollama / LM Studio           | Inference on your Mac using the selected local model                                   |

Docker is needed for **verified tasks**, because an agent executes commands and
edits files in a disposable workspace. Agent containers can contact the local
model host bridge; verifier containers have no network access and hold their own
checks. Your repository and personal files are not mounted into those workspaces.
Docker is not required for the existing CLI speed benchmarks.

`tasks/local-v1` starts with two coding tasks (exact bill splitting and CSV parsing)
and one operations task (support ticket routing). These three fixtures are an
integration/smoke suite, **not a broad coding leaderboard**. A pass means the saved
artifact passed independent functional checks; an agent's completion message does
not determine its score. Setup errors, execution errors, and missing grades appear
separately; success is passes divided by independently graded attempts. Always
review errors and completion counts alongside the percentage. Turn and time budgets
are recorded, and automatic trial retries are disabled.

Runs are serialized to avoid competing for the same GPU. History, task hashes,
configuration, available model digest/runtime metadata and host hardware, Harbor
results, Pi trajectories, verifier logs and artifacts remain
in the selected run directory (`out/studio/<run-id>/` by default). Compare the same task selection, suite revision, harness,
budgets, server configuration and hardware. Model IDs alone do not identify exact
weights or quantization; keep your server's model configuration when reporting scores.
A cancelled run retains its logs; restarting Studio marks unfinished runs interrupted.

The older `agentic` phase remains a tool-calling/latency smoke test with a virtual
filesystem. Use **Verified tasks** for actual command execution and outcome scoring.
All CLI runs now save `results.json` alongside their HTML report.

The UI uses Agent-Native's typed action layer; it does not include a separate cloud
assistant or require an Agent-Native hosted service. Alternative harnesses can be
added through Harbor agent adapters, keeping the tasks and graders independent.

```bash
npm run studio:test     # local runner and API regression checks
npm run studio:build    # build the optional UI
node studio/server.mjs --production
npm test                # existing CLI regression suite
```

New Studio benchmarks default to 4,096 output tokens per turn, a 600-second task
time limit and a 131,072-token context window. Match the context window to your
local server's capacity in **Advanced**; this setting does not resize the server's
context or guarantee that a model completes a task correctly.

If a task fails, inspect its outcome, transcript and saved artifact. Studio labels
output-token truncation separately from the turn budget and shows tool errors.
A final response with `finish_reason: length` can end before a valid write/edit call,
leaving the original broken file unchanged. For a new attempt, increase **Advanced →
Output tokens / turn** and the task time limit together; **Run again** preserves the
previous budgets. Zero temperature can reproduce the same failure across attempts.
A server-side tool-decoding error (for example a missing function-call wrapper) is
an execution error, not evidence that the resulting code failed functional checks.
These diagnostics do not change the checks or the score.

The npm package ships the Studio sources and pinned dependency lockfile alongside
the dependency-free CLI. UI dependencies are installed only when Studio is launched.
Compiled binaries continue to ship only the lightweight CLI.
