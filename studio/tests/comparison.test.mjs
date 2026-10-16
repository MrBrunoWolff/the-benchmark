import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonDifferences, taskComparison, toggleComparison } from '../lib/comparison.mjs';
const makeRun = (id, model, extra = {}) => ({ id, status: 'completed', config: { kind: 'tasks', model, tasks: ['csv-parser'], repeats: 3, maxTurns: 24, ...extra }, taskHashes: { 'csv-parser': 'abc' }, versions: { adapter: '2' }, trials: [] });
test('comparison selects different models and replaces an older attempt of the same model', () => {
 const a = makeRun('a', 'model-a'), b = makeRun('b', 'model-b'), next = makeRun('next', 'model-a');
 const runs = [a, b, next];
 assert.deepEqual(toggleComparison(['a', 'b'], next, runs), ['b', 'next']);
 assert.deepEqual(toggleComparison(['a', 'b'], a, runs), ['b']);
 assert.deepEqual(toggleComparison([], { ...a, status: 'running' }, runs), []);
});
test('task pass charts include errors and missing attempts in their denominator; passing time excludes fast failures', () => {
 const run = makeRun('a', 'model-a', { repeats: 5 });
 run.trials = [{task:'csv-parser',status:'passed',seconds:20}, {task:'csv-parser',status:'passed',seconds:40}, {task:'csv-parser',status:'failed',seconds:1}, {task:'csv-parser',status:'error',seconds:2}];
 assert.deepEqual(taskComparison(run, 'csv-parser'), { expected:5, passed:2, failed:1, errors:1, ungraded:0, missing:1, rate:0.4, median:30 });
 assert.equal(taskComparison(run, 'money-split'), null);
 assert.equal(taskComparison(makeRun('b', 'model-b'), 'csv-parser').median, null);
});
test('comparison reports exact setting differences but ignores object and task ordering', () => {
 const a = makeRun('a', 'model-a', {tasks:['csv-parser','money-split']});
 const b = makeRun('b', 'model-b', {tasks:['money-split','csv-parser']});
 a.taskHashes = {'csv-parser':'a','money-split':'b'};
 b.taskHashes = {'money-split':'b','csv-parser':'a'};
 assert.deepEqual(comparisonDifferences([a,b]), []);
 b.config.repeats=2; b.config.maxTokens=8192; b.hardware={cpu:'other'};
 assert.deepEqual(comparisonDifferences([a,b]), ['Attempts per task','Output token limit','Hardware']);
});
