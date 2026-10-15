export function splitBill(totalCents, people) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new RangeError('totalCents must be a nonnegative safe integer');
  }
  if (!Number.isSafeInteger(people) || people <= 0 || people > 10000) {
    throw new RangeError('people must be a positive safe integer no greater than 10000');
  }
  const base = Math.floor(totalCents / people);
  const remainder = totalCents % people;
  const result = [];
  for (let i = 0; i < people; i++) {
    result.push(i < remainder ? base + 1 : base);
  }
  return result;
}

// Local tests
const assert = (cond, msg) => {
  if (!cond) throw new Error('Assertion failed: ' + msg);
};

// Test 1: basic split
const r1 = splitBill(100, 3);
assert(r1.length === 3, 'length');
assert(r1.reduce((a, b) => a + b, 0) === 100, 'sum');
assert(r1[0] >= r1[1] && r1[1] >= r1[2], 'order (earlier get more)');

// Test 2: remainder goes to earlier people
const r2 = splitBill(7, 3);
assert(r2[0] === 3 && r2[1] === 2 && r2[2] === 2, 'remainder distribution');
assert(r2.reduce((a, b) => a + b, 0) === 7, 'sum');

// Test 3: exact division
const r3 = splitBill(60, 5);
assert(r3.length === 5 && r3.every(x => x === 12), 'exact division');

// Test 4: zero total
const r4 = splitBill(0, 5);
assert(r4.length === 5 && r4.every(x => x === 0), 'zero total');

// Test 5: single person
const r5 = splitBill(42, 1);
assert(r5.length === 1 && r5[0] === 42, 'single person');

// Test 6: large people count
const r6 = splitBill(10000, 10000);
assert(r6.length === 10000 && r6.every(x => x === 1), 'large people');

// Test 7: invalid totalCents (negative)
try {
  splitBill(-1, 5);
  assert(false, 'should throw for negative totalCents');
} catch (e) {
  assert(e instanceof RangeError, 'negative throws RangeError');
}

// Test 8: invalid totalCents (non-integer)
try {
  splitBill(10.5, 5);
  assert(false, 'should throw for non-integer totalCents');
} catch (e) {
  assert(e instanceof RangeError, 'non-integer throws RangeError');
}

// Test 9: invalid people (zero)
try {
  splitBill(10, 0);
  assert(false, 'should throw for zero people');
} catch (e) {
  assert(e instanceof RangeError, 'zero people throws RangeError');
}

// Test 10: invalid people (too large)
try {
  splitBill(10, 10001);
  assert(false, 'should throw for too many people');
} catch (e) {
  assert(e instanceof RangeError, 'too many people throws RangeError');
}

console.log('All tests passed!');
