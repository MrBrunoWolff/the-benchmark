#!/usr/bin/env node

if (['--help', '-h', 'help'].includes(process.argv[2])) {
  console.log(`Usage: the-benchmark [options]
       the-benchmark studio [--port 4310] [--data-dir PATH] [--setup]

CLI only (no UI dependencies or Docker required):
  npx -y the-benchmark --target ollama --model MODEL
  bunx the-benchmark --target ollama --phases generation --runs 3

Local UI (optional dependencies install automatically on first launch):
  npx -y the-benchmark studio
  bunx the-benchmark studio
  Aliases: ui, --ui. Run studio --help for UI options.

CLI options:
  --target ollama|lmstudio    Select a local server
  --url URL                  Use another OpenAI-compatible endpoint
  --model MODEL              Select a model
  --phases LIST              prefill,generation,concurrent,agentic,system-one
  --runs NUMBER              Repeats per measurement
  --concurrency LIST         For example: 1,2,4,8
  --reasoning LEVEL          Request a reasoning level (server dependent)
  --out PATH                 Save HTML and JSON results
  --json                     Also print JSON results

Verified tasks in the UI require Docker. Serving measurements do not.
CLI reference: https://github.com/MrBrunoWolff/the-benchmark/blob/main/docs/cli.md`);
} else if (['studio', 'ui', '--ui'].includes(process.argv[2])) {
  try {
    const { launchStudio } = await import('./scripts/launch-studio.mjs');
    await launchStudio(process.argv.slice(3));
  } catch (error) {
    console.error(`Studio: ${error.message}`);
    process.exitCode = 1;
  }
} else {
  await import('./bench.mjs');
}
