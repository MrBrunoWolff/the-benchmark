import assert from "node:assert/strict";
import { test } from "node:test";
import { publishPackage } from "./publish-npm.mjs";

const pkg = { name: "@example/components", version: "1.1.0" };
const missing = {
  status: 1,
  stdout: JSON.stringify({ error: { code: "E404" } }),
  stderr: "npm error code E404",
};
const visible = { status: 0, stdout: '"1.1.0"', stderr: "" };
const accepted = {
  status: 0,
  stdout: "+ @example/components@1.1.0",
  stderr: "",
};
const staged = {
  status: 1,
  stdout: "",
  stderr: 'npm error code E409\nnpm error Cannot publish over previously staged version "1.1.0".',
};

function scenario(results) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    options: {
      attempts: 3,
      interval: 30_000,
      log: () => {},
      sleep: async (ms) => sleeps.push(ms),
      run: (args) => {
        calls.push(args[0]);
        assert.ok(results.length, "unexpected npm command");
        return results.shift();
      },
    },
  };
}

test("already published version never invokes publish", async () => {
  const s = scenario([visible]);
  await publishPackage(pkg, s.options);
  assert.deepEqual(s.calls, ["view"]);
});

for (const [label, upload] of [
  ["accepted upload", accepted],
  ["staged conflict", staged],
]) {
  test(`${label} waits for visibility without republishing`, async () => {
    const s = scenario([missing, upload, missing, visible]);
    await publishPackage(pkg, s.options);
    assert.deepEqual(s.calls, ["view", "publish", "view", "view"]);
    assert.deepEqual(s.sleeps, [30_000]);
  });

  test(`${label} fails if the version remains unavailable`, async () => {
    const s = scenario([missing, upload, missing, missing, missing]);
    await assert.rejects(publishPackage(pkg, s.options), /still unavailable/);
    assert.equal(s.calls.filter((call) => call === "publish").length, 1);
    assert.equal(s.sleeps.length, 2);
  });
}

test("auth errors and unrelated conflicts fail immediately", async () => {
  for (const stderr of [
    "npm error code EOTP",
    "npm error code E404",
    "npm error code E409\nnpm error unrelated conflict",
    'npm error code E409\nCannot publish over previously staged version "1.0.0".',
  ]) {
    const s = scenario([missing, { status: 1, stdout: "", stderr }]);
    await assert.rejects(publishPackage(pkg, s.options), /npm publish failed/);
    assert.deepEqual(s.calls, ["view", "publish"]);
    assert.deepEqual(s.sleeps, []);
  }
});

test("registry outages fail before publishing and during polling", async () => {
  const outage = {
    status: 1,
    stdout: JSON.stringify({ error: { code: "E503" } }),
    stderr: "npm error code E503",
  };
  for (const results of [[outage], [missing, staged, outage]]) {
    const s = scenario(results);
    await assert.rejects(publishPackage(pkg, s.options), /Registry lookup failed/);
    assert.deepEqual(s.sleeps, []);
  }
});
