#!/bin/bash
set -euo pipefail
cat > /app/split.mjs <<'REFERENCE_SOLUTION'
export function splitBill(totalCents, people) {
 if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isSafeInteger(people) || people <= 0 || people > 10000) throw new RangeError('Invalid inputs');
 const base=Math.floor(totalCents/people), rem=totalCents%people;
 return Array.from({length:people},(_,i)=>base+(i<rem?1:0));
}
REFERENCE_SOLUTION
