import assert from 'node:assert/strict';
import { createChecks } from './check-runner.mjs';
const { check, finish } = createChecks();
let valid = 0, invalid = 0;
import { splitBill } from '/app/split.mjs';
for (const [total, people] of [[100,3],[1,4],[0,2],[101,1],[99999,11],[Number.MAX_SAFE_INTEGER,7],[42,10000]]) {
 check(`valid-${++valid}`, `Split ${total} cents among ${people} people`, () => {
 const shares=splitBill(total,people);
 assert.equal(shares.length,people);
 assert.equal(shares.reduce((a,b)=>a+b,0),total);
 assert.ok(shares.every(Number.isSafeInteger));
 const base=Math.floor(total/people), remainder=total%people;
 assert.deepEqual(shares,Array.from({length:people},(_,i)=>base+(i<remainder?1:0)));
 });
}
for (const [total,people] of [[-1,2],[1.1,2],[100,0],[100,-1],[100,1.5],[100,10001],[Infinity,2],['100',2],[100,'2'],[Number.MAX_SAFE_INTEGER+1,2]]) {
 check(`invalid-${++invalid}`, `Reject total=${typeof total === 'string' ? JSON.stringify(total) : String(total)}, people=${typeof people === 'string' ? JSON.stringify(people) : String(people)}`, () => assert.throws(()=>splitBill(total,people),RangeError));
}
finish();
