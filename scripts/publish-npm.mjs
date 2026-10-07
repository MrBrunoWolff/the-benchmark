import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Run from the package root so npm retains the workflow's OIDC identity
// and the package's existing lifecycle scripts.
export async function publishPackage(
  { name, version },
  {
    run = (args) => spawnSync("npm", args, { encoding: "utf8" }),
    sleep = setTimeout,
    log = console.log,
    attempts = 40,
    interval = 30_000,
  } = {},
) {
  const spec = `${name}@${version}`;
  function available() {
    const result = run([
      "view",
      spec,
      "version",
      "--json",
      "--fetch-retries=0",
      "--fetch-timeout=15000",
    ]);
    if (result.error) throw result.error;
    if (result.status === 0) {
      // npm 12 returns an array even for an exact version; older CLIs return
      // a string. Confirm exactly one matching version in either format.
      const value = JSON.parse(result.stdout);
      const versions = Array.isArray(value) ? value : [value];
      if (versions.length !== 1 || versions[0] !== version)
        throw new Error(`Unexpected registry version for ${spec}`);
      return true;
    }
    // Only a missing version permits publishing or continued polling.
    // Authentication, network and registry errors must remain failures.
    let code;
    try {
      code = JSON.parse(result.stdout).error?.code;
    } catch {
      // Preserve npm's diagnostic below if it did not return JSON.
    }
    if (code === "E404") return false;
    throw new Error(`Registry lookup failed for ${spec}: ${result.stderr}`);
  }

  if (available()) {
    log(`${spec} is already available; skipping publish.`);
    return;
  }

  log(`Publishing ${spec} via trusted publishing.`);
  const result = run(["publish", "--access", "public"]);
  if (result.stdout) log(result.stdout);
  if (result.stderr) log(result.stderr);
  if (result.error) throw result.error;
  const stagedConflict =
    /\bE409\b/.test(result.stderr) &&
    result.stderr.includes(`Cannot publish over previously staged version "${version}"`);
  if (result.status !== 0 && !stagedConflict)
    throw new Error(`npm publish failed for ${spec} (exit ${result.status}).`);

  // npm scans accepted uploads before making them installable. A subsequent
  // workflow can get this specific E409 while that first upload is pending.
  // Never republish or call a staged conflict success without confirmation.
  log(`Waiting for ${spec} to become available after npm scanning.`);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (available()) {
      log(`${spec} is confirmed available on npm.`);
      return;
    }
    if (attempt + 1 < attempts) await sleep(interval);
  }
  throw new Error(
    `${spec} is still unavailable after ${attempts} registry checks. Check npm's review status before retrying; this workflow did not republish it.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await publishPackage(JSON.parse(readFileSync("package.json", "utf8")));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
