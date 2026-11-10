import { splitBill } from './split.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Test 1: normal distribution
splitBill(100, 3);
const r1 = splitBill(100, 3);
assert(r1.length === 3, 'length should be people');
assert(r1.reduce((a, b) => a + b, 0) === 100, 'sum must equal totalCents');
assert(r1[0] - r1[2] <= 1 && Math.abs(r1[0] - r1[1]) <= 1, 'shares differ by at most one cent');
console.log('Test 1 passed:', JSON.stringify(r1));

// Test 2: remainder to earlier people
splitBill(5, 2);
const r2 = splitBill(5, 2);
assert(r2[0] === 3 && r2[1] === 2, 'first gets extra cent');
console.log('Test 2 passed:', JSON.stringify(r2));

// Test 3: zero total
splitBill(0, 5);
const r3 = splitBill(0, 5);
assert(r3.every(v => v === 0), 'all zeros when total is 0');
console.log('Test 3 passed:', JSON.stringify(r3));

// Test 4: more people than cents
splitBill(7, 10);
const r4 = splitBill(7, 10);
assert(r4.length === 10, 'length should be people');
assert(r4.reduce((a, b) => a + b, 0) === 7, 'sum must equal totalCents');
console.log('Test 4 passed:', JSON.stringify(r4));

// Test 5: invalid - negative total
try {
  splitBill(-1, 3);
  console.error('FAIL: should have thrown for negative total');
} catch (e) {
  assert(e instanceof RangeError, 'negative totalCents throws RangeError');
  console.log('Test 5 passed: negative input rejected');
}

// Test 6: invalid - non-integer
try {
  splitBill(100.5, 3);
  console.error('FAIL: should have thrown for non-integer');
} catch (e) {
  assert(e instanceof RangeError, 'non-integer totalCents throws RangeError');
  console.log('Test 6 passed: non-integer input rejected');
}

// Test 7: invalid - people <= 0
try {
  splitBill(100, 0);
  console.error('FAIL: should have thrown for zero people');
} catch (e) {
  assert(e instanceof RangeError, 'zero people throws RangeError');
  console.log('Test 7 passed: zero people rejected');
}

// Test 8: invalid - people > 10000
try {
  splitBill(100, 10001);
  console.error('FAIL: should have thrown for too many people');
} catch (e) {
  assert(e instanceof RangeError, 'people > 10000 throws RangeError');
  console.log('Test 8 passed: too many people rejected');
}

console.log('All tests completed.');
