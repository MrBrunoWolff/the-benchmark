import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { createChecks } from './check-runner.mjs';
const { check, finish } = createChecks();
let actual;
check('json', 'Artifact is valid JSON', () => { actual = JSON.parse(readFileSync('/app/triage.json', 'utf8')); });
const expected=[['t1','billing','low',true],['t2','technical','high',false],['t3','technical','medium',false],['t4','sales','low',false],['t5','billing','low',false],['t6','other','low',false]].map(([id,department,priority,refund_requested])=>({id,department,priority,refund_requested}));
check('structure', 'Exactly six tickets in an array', () => { assert.ok(Array.isArray(actual)); assert.equal(actual.length, expected.length); });
for (const [index, ticket] of expected.entries()) {
  check(ticket.id, `Ticket ${ticket.id}: department, priority, refund and input order`, () => assert.deepEqual(actual?.[index], ticket));
}
finish();
