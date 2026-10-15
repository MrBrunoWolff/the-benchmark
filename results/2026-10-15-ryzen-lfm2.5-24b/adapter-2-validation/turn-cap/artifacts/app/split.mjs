export function splitBill(totalCents, people) {
  return Array(people).fill(Math.round(totalCents / people));
}
