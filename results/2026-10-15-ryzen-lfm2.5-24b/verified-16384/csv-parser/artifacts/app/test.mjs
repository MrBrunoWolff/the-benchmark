import { parseCSV } from './csv.mjs';

// Test 1: Empty input
console.log('Test 1 (empty):', JSON.stringify(parseCSV('')));

// Test 2: Simple rows
console.log('Test 2 (simple):', JSON.stringify(parseCSV('a,b,c')));

// Test 3: With newlines in quoted fields
const t3 = parseCSV(`a,"b,c",d`);
console.log('Test 3 (quoted comma):', JSON.stringify(t3));

// Test 4: CRLF line endings
const t4 = parseCSV('a,b\r\nc,d');
console.log('Test 4 (CRLF):', JSON.stringify(t4));

// Test 5: Escaped double quotes
const t5 = parseCSV('a,"b""c",d');
console.log('Test 5 (escaped quotes):', JSON.stringify(t5));

// Test 6: Empty fields
const t6 = parseCSV('a,,b');
console.log('Test 6 (empty field):', JSON.stringify(t6));

// Test 7: Trailing newline without extra row
const t7 = parseCSV('a,b\n');
console.log('Test 7 (trailing newline):', JSON.stringify(t7));

// Test 8: No trailing newline
const t8 = parseCSV('a,b');
console.log('Test 8 (no trailing newline):', JSON.stringify(t8));

// Test 9: Unclosed quote should throw
try {
  parseCSV('a,"b,c');
  console.log('Test 9 (unclosed quote): FAILED - no error thrown');
} catch (e) {
  console.log('Test 9 (unclosed quote):', e.message);
}

// Test 10: Preserve spaces within fields
const t10 = parseCSV('a, b , c');
console.log('Test 10 (spaces):', JSON.stringify(t10));
