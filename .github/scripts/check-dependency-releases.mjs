import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MINIMUM_RELEASE_AGE_SECONDS = 259200;
export const PRERELEASE_EXCEPTIONS = new Set(["cf", "@cloudflare/vite-plugin"]);
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

// Bun lockfiles allow comments and trailing commas. Preserve strings verbatim.
export function parseJsonc(text) {
  let result = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      result += char;
      if (char === "\\") result += text[++i] ?? "";
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      result += char;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      result += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      if (i >= text.length) throw new Error("Unterminated JSON comment");
      i++;
      result += " ";
    } else if (char === ",") {
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      // A comment after a comma is handled by a second string-aware pass.
      result += ["}", "]"].includes(text[next]) ? "" : char;
    } else result += char;
  }
  if (quoted) throw new Error("Unterminated JSON string");
  if (result !== text && /,\s*[}\]]/.test(result)) return parseJsonc(result);
  return JSON.parse(result);
}

export function isPrerelease(version) {
  return (
    (versionPattern.test(version) && version.split("+")[0].includes("-")) ||
    /^\d+(?:\.\d+)*[.-][A-Za-z]/.test(version)
  );
}

function npmResolution(value) {
  if (typeof value !== "string") return null;
  const split = value.lastIndexOf("@");
  if (split <= 0) return null;
  const name = value.slice(0, split).replace(/^npm:/, "");
  const version = value.slice(split + 1);
  return versionPattern.test(version) ? { name, version } : null;
}

export function collectDependencies(files) {
  const resolutions = new Map();
  const declarations = new Map();
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith("Gemfile.lock")) {
      let section = "";
      for (const line of text.split("\n")) {
        if (/^[A-Z][A-Z ]*$/.test(line)) section = line;
        const match = section === "GEM" && line.match(/^    ([\w-]+) \(([^)]+)\)$/);
        if (!match) continue;
        const version = match[2].replace(/-(?:x86_64|x64|x86|aarch64|arm64|arm|ruby|java).*/, "");
        resolutions.set(`rubygems:${match[1]}@${version}`, {
          name: match[1],
          version,
          source: "rubygems",
        });
      }
      continue;
    }
    const value = parseJsonc(text);
    if (path.endsWith("package.json") && !path.endsWith("package-lock.json")) {
      for (const section of dependencySections) {
        for (const [name, requirement] of Object.entries(value[section] ?? {})) {
          if (typeof requirement !== "string")
            throw new Error(`Unsupported requirement: ${path}: ${name}`);
          declarations.set(`${path}:${section}:${name}`, { path, name, requirement });
          const exact = requirement.match(
            /^[~^=]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/,
          );
          if (exact) resolutions.set(`${name}@${exact[1]}`, { name, version: exact[1] });
        }
      }
    } else if (path.endsWith("bun.lock")) {
      for (const entry of Object.values(value.packages ?? {})) {
        const dependency = npmResolution(Array.isArray(entry) ? entry[0] : entry);
        if (dependency) resolutions.set(`${dependency.name}@${dependency.version}`, dependency);
      }
    } else if (path.endsWith("package-lock.json")) {
      if (!value.packages)
        throw new Error(`Unsupported npm lockfile: ${path}; use lockfileVersion 2 or 3`);
      for (const [location, entry] of Object.entries(value.packages)) {
        if (!location || !versionPattern.test(entry.version ?? "")) continue;
        const name = entry.name ?? location.split("node_modules/").at(-1);
        resolutions.set(`${name}@${entry.version}`, { name, version: entry.version });
      }
    }
  }
  return { resolutions, declarations };
}

export function changedDependencies(before, after) {
  const problems = [];
  for (const [key, declaration] of after.declarations) {
    if (before.declarations.get(key)?.requirement === declaration.requirement) continue;
    const requirement = declaration.requirement;
    if (
      !PRERELEASE_EXCEPTIONS.has(declaration.name) &&
      (/\d+\.\d+\.\d+-[0-9A-Za-z]/.test(requirement) ||
        /^(?:alpha|beta|canary|dev|experimental|insiders|next|nightly|preview|rc)$/.test(
          requirement,
        ))
    ) {
      problems.push(
        `${declaration.path}: ${declaration.name} declares a prerelease (${requirement})`,
      );
    } else if (/^(?:git(?:\+|:)|github:|https?:|[\w.-]+\/[\w.-]+#)/.test(requirement)) {
      problems.push(
        `${declaration.path}: ${declaration.name} uses an unverified Git or URL release (${requirement})`,
      );
    }
  }
  const changed = [...after.resolutions]
    .filter(([key]) => !before.resolutions.has(key))
    .map(([, value]) => value);
  for (const dependency of changed) {
    if (isPrerelease(dependency.version) && !PRERELEASE_EXCEPTIONS.has(dependency.name))
      problems.push(`New prerelease resolution: ${dependency.name}@${dependency.version}`);
  }
  return { changed, problems };
}

export async function checkReleaseAges(
  dependencies,
  fetchTimes,
  { now = Date.now(), securityUpdate = false } = {},
) {
  const problems = [];
  const cache = new Map();
  for (const { name, version, source = "npm" } of dependencies) {
    if (isPrerelease(version) && !PRERELEASE_EXCEPTIONS.has(name)) continue; // Rejected by changedDependencies.
    const key = `${source}:${name}`;
    if (!cache.has(key)) cache.set(key, Promise.resolve(fetchTimes(name, source)));
    const times = await cache.get(key);
    const published = Date.parse(times[version]);
    if (!Number.isFinite(published)) {
      problems.push(`Cannot verify publication time: ${name}@${version}`);
      continue;
    }
    if (published > now) problems.push(`Publication time is in the future: ${name}@${version}`);
    else if (
      (!securityUpdate || PRERELEASE_EXCEPTIONS.has(name)) &&
      now - published < MINIMUM_RELEASE_AGE_SECONDS * 1000
    ) {
      problems.push(`Release is younger than three days: ${name}@${version} (${times[version]})`);
    }
  }
  return problems;
}

function isDependencyFile(path) {
  return (
    /(?:^|\/)(?:package\.json|bun\.lock|package-lock\.json|Gemfile\.lock)$/.test(path) &&
    !/(?:^|\/)(?:node_modules|vendor|\.agents|\.claude|\.codex|fixtures|tests?)(?:\/|$)/.test(path)
  );
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

async function fetchTimes(name, source) {
  const url =
    source === "rubygems"
      ? `https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`
      : `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status} for ${name}`);
  const metadata = await response.json();
  if (source === "rubygems")
    return Object.fromEntries(metadata.map((version) => [version.number, version.created_at]));
  if (!metadata.time) throw new Error(`Registry returned no publication timestamps for ${name}`);
  return metadata.time;
}

async function main() {
  const args = process.argv.slice(2);
  let base = process.env.DEPENDENCY_POLICY_BASE || "HEAD";
  let securityUpdate = process.env.DEPENDENCY_SECURITY_UPDATE === "true";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--security-update") securityUpdate = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const commit = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
  const before = {};
  for (const path of git("ls-tree", "-rz", "--name-only", commit)
    .split("\0")
    .filter(isDependencyFile)) {
    before[path] = git("show", `${commit}:${path}`);
  }
  const after = {};
  for (const path of git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter(isDependencyFile)) {
    if (existsSync(path)) after[path] = readFileSync(path, "utf8");
  }
  const { changed, problems } = changedDependencies(
    collectDependencies(before),
    collectDependencies(after),
  );
  problems.push(...(await checkReleaseAges(changed, fetchTimes, { securityUpdate })));
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
  else
    console.log(
      `Dependency release policy passed: ${changed.length} new resolutions checked; ${securityUpdate ? "security age exception" : "three-day minimum"}; new prereleases forbidden except cf and @cloudflare/vite-plugin.`,
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
