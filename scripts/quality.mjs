import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "quality.config.json"), "utf8"));
const selected = process.argv[2] ?? "all";
if (selected !== "all" && !Object.hasOwn(config.stages, selected)) {
  throw new Error(`Unknown quality stage: ${selected}`);
}
const stages = selected === "all" ? Object.keys(config.stages) : [selected];
let failed = false;
for (const stage of stages) {
  let passed = true;
  for (const command of config.stages[stage]) {
    if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== "string")) {
      throw new Error(`Invalid command in ${stage}`);
    }
    const args = [...command];
    const executable = args.shift();
    if (executable === "playwright-install") {
      args.unshift("--no-install", "playwright", "install", ...(process.env.CI && process.platform === "linux" ? ["--with-deps"] : []), "chromium");
    }
    const bin = executable === "playwright-install" ? "bunx" : executable;
    console.log(`\n[quality:${stage}] ${bin} ${args.join(" ")}`);
    const result = spawnSync(bin, args, { cwd: root, stdio: "inherit", env: process.env });
    if (result.error || result.status !== 0) {
      const message = `${stage} failed: ${bin} ${args.join(" ")} (exit ${result.status ?? "unavailable"})`;
      console.error(message);
      if (process.env.GITHUB_ACTIONS) console.error(`::error title=Quality ${stage}::${message}`);
      if (result.error) console.error(result.error.message);
      passed = false;
      failed = true;
      break;
    }
  }
  const summary = `- ${stage}: ${passed ? "passed" : "failed"} (${config.tier})\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
process.exitCode = failed ? 1 : 0;
