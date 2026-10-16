import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../lib/config.mjs';
import { parseCheckReport, summarizeChecks } from '../lib/checks.mjs';
import { taskResults, summarize } from '../lib/results.mjs';

const report = { schemaVersion: 1, complete: true, checks: [
  { id: 'a', label: 'First', status: 'passed' },
  { id: 'b', label: 'Second', status: 'failed', expected: "[ [ '' ] ]", actual: '[]' },
] };

test('check reports reject incomplete, duplicate and invalid results; historical trials stay unknown', () => {
  for (const bad of [null, {}, { ...report, complete: false }, { ...report, checks: [] },
    { ...report, checks: [report.checks[0], report.checks[0]] },
    { ...report, checks: [{ id: 'a', label: 'bad', status: 'skipped' }] }]) assert.equal(parseCheckReport(bad), null);
  assert.equal(summarizeChecks([{}], 3), null);
  const checks = parseCheckReport(report, 'artifact-replay');
  assert.deepEqual(summarizeChecks([{ checks }, {}], 3), { passed: 1, failed: 1, total: 2, rate: 0.5,
    reportedAttempts: 1, expectedAttempts: 3, replayedAttempts: 1 });
});

test('check reports and artifact replays supplement original grades without replacing them', () => {
  const root = mkdtempSync(join(tmpdir(), 'benchmark-check-results-'));
  try {
    const trial = join(root, 'job', 'trial'); mkdirSync(join(trial, 'verifier'), { recursive: true });
    writeFileSync(join(trial, 'result.json'), JSON.stringify({ trial_name: 'trial', task_name: 'csv-parser', verifier_result: { rewards: { reward: 0 } } }));
    assert.equal(taskResults(root)[0].checks, null);
    writeFileSync(join(trial, 'verifier/check-replay.json'), JSON.stringify(report));
    let trials = taskResults(root);
    assert.equal(trials[0].status, 'failed'); assert.equal(trials[0].checks.source, 'artifact-replay');
    assert.equal(summarize(trials, 3).checks.reportedAttempts, 1);
    writeFileSync(join(trial, 'verifier/check-results.json'), JSON.stringify({ ...report, checks: [report.checks[0]] }));
    trials = taskResults(root);
    assert.equal(trials[0].checks.source, 'verifier'); assert.equal(trials[0].status, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function verifyFixture(task, kind) {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-grader-'));
  const tests = join(ROOT, 'tasks/local-v1', task, 'tests');
  const target = task === 'csv-parser' ? 'csv.mjs' : task === 'money-split' ? 'split.mjs' : 'triage.json';
  try {
    mkdirSync(join(directory, 'app')); mkdirSync(join(directory, 'logs'));
    const solution = readFileSync(join(ROOT, 'tasks/local-v1', task, 'solution/solve.sh'), 'utf8').split("<<'REFERENCE_SOLUTION'\n")[1].split('\nREFERENCE_SOLUTION')[0];
    const fixture = task === 'ticket-triage' ? '[]' : readFileSync(join(ROOT, 'tasks/local-v1', task, 'environment', target), 'utf8');
    const value = kind === 'reference' ? solution : kind === 'csv-edge-bug' ? solution.replace('if(field.length||row.length||!/[\\r\\n]$/.test(text))', 'if(field.length||row.length)') : fixture;
    writeFileSync(join(directory, 'app', target), value);
    for (const file of ['checks.mjs', 'check-runner.mjs', 'verify.mjs']) {
      let source = readFileSync(join(tests, file), 'utf8').replaceAll('/app/', `${directory}/app/`).replaceAll('/tests/', `${directory}/`).replaceAll('/logs/verifier/', `${directory}/logs/`);
      writeFileSync(join(directory, file), source);
    }
    const result = spawnSync(process.execPath, [join(directory, 'verify.mjs')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(directory, 'logs/check-results.json')), result.stdout + result.stderr);
    const reward = readFileSync(join(directory, 'logs/reward.txt'), 'utf8');
    const checks = parseCheckReport(JSON.parse(readFileSync(join(directory, 'logs/check-results.json'), 'utf8')));
    return { reward, checks };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('all reference solutions pass every check and original broken fixtures still fail', () => {
  for (const [task, count] of [['money-split', 17], ['csv-parser', 13], ['ticket-triage', 8]]) {
    const good = verifyFixture(task, 'reference');
    assert.equal(good.reward, '1', task); assert.equal(good.checks.checks.length, count);
    assert.ok(good.checks.checks.every(c => c.status === 'passed'));
    const bad = verifyFixture(task, 'broken');
    assert.equal(bad.reward, '0', task); assert.equal(bad.checks.checks.length, count);
    assert.ok(bad.checks.checks.some(c => c.status === 'failed'));
  }
});

test('CSV edge-case regression reports all checks and retains a failing task reward', () => {
  const result = verifyFixture('csv-parser', 'csv-edge-bug');
  assert.equal(result.reward, '0');
  assert.equal(result.checks.checks.filter(c => c.status === 'passed').length, 12);
  assert.equal(result.checks.checks.filter(c => c.status === 'failed').length, 1);
  assert.equal(result.checks.checks.find(c => c.status === 'failed').label, 'Single empty quoted field');
});

test('verifier cannot award a pass to a zero-exit child with no complete report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-incomplete-checks-'));
  try {
    writeFileSync(join(directory, 'checks.mjs'), "console.log('no check report');");
    const source = readFileSync(join(ROOT, 'tasks/local-v1/csv-parser/tests/verify.mjs'), 'utf8')
      .replaceAll('/tests/', `${directory}/`).replaceAll('/logs/verifier/', `${directory}/`);
    writeFileSync(join(directory, 'verify.mjs'), source);
    const result = spawnSync(process.execPath, [join(directory, 'verify.mjs')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0); assert.equal(readFileSync(join(directory, 'reward.txt'), 'utf8'), '0');
    assert.equal(existsSync(join(directory, 'check-results.json')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
