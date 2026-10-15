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
    if (i < remainder) {
      result.push(base + 1);
    } else {
      result.push(base);
    }
  }
  return result;
}
