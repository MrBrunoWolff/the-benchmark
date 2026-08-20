#!/usr/bin/env bun
/**
 * Cross-compiles bench.mjs into standalone binaries for GitHub releases.
 *
 * This is an addition alongside `npx`/`bunx`, not a replacement: a binary needs
 * no Node and no Bun installed, which suits benchmarking a machine you would
 * rather not install a toolchain on. The trade-off is size — each one embeds a
 * runtime and lands around 60-80 MB.
 *
 * `--format=esm` is required, not cosmetic: bench.mjs uses top-level await, and
 * the default CJS output makes that a syntax error ("await can only be used
 * inside an async function"). ESM bytecode compilation is what makes this work.
 */
import { $ } from "bun";
import { mkdirSync } from "node:fs";

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const;

const OUT = "binaries";
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = only.length ? TARGETS.filter((t) => only.includes(t)) : TARGETS;
if (!targets.length) {
  console.error(`no matching target; expected one of:\n  ${TARGETS.join("\n  ")}`);
  process.exit(1);
}

for (const target of targets) {
  const ext = target.includes("windows") ? ".exe" : "";
  const outfile = `${OUT}/the-benchmark-${target.replace("bun-", "")}${ext}`;
  console.log(`building ${outfile}`);
  await $`bun build --compile --bytecode --format=esm --target=${target} bench.mjs --outfile ${outfile}`;
}

console.log(`\ndone — ${targets.length} binary/binaries in ${OUT}/`);
