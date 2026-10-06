import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const actual=JSON.parse(readFileSync('/app/triage.json','utf8'));
const expected=[['t1','billing','low',true],['t2','technical','high',false],['t3','technical','medium',false],['t4','sales','low',false],['t5','billing','low',false],['t6','other','low',false]].map(([id,department,priority,refund_requested])=>({id,department,priority,refund_requested}));
assert.deepEqual(actual,expected);
console.log('All functional checks passed');
