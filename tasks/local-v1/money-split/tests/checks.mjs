import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { splitBill } from '/app/split.mjs';
for (const [total, people] of [[100,3],[1,4],[0,2],[101,1],[99999,11],[Number.MAX_SAFE_INTEGER,7],[42,10000]]) {
 const shares=splitBill(total,people);
 assert.equal(shares.length,people);
 assert.equal(shares.reduce((a,b)=>a+b,0),total);
 assert.ok(shares.every(Number.isSafeInteger));
 const base=Math.floor(total/people), remainder=total%people;
 assert.deepEqual(shares,Array.from({length:people},(_,i)=>base+(i<remainder?1:0)));
}
for (const [total,people] of [[-1,2],[1.1,2],[100,0],[100,-1],[100,1.5],[100,10001],[Infinity,2],['100',2],[100,'2'],[Number.MAX_SAFE_INTEGER+1,2]]) {
 assert.throws(()=>splitBill(total,people),RangeError);
}
console.log('All functional checks passed');
