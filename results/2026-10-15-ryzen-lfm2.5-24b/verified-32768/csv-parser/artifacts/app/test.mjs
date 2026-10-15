import { parseCSV } from './csv.mjs';

// Test 1: Basic rows
console.log('Test 1:', JSON.stringify(parseCSV('a,b,c\n1,2,3')));

// Test 2: Empty input
console.log('Test 2:', JSON.stringify(parseCSV('')));

// Test 3: Trailing newline (no extra empty row)
console.log('Test 3:', JSON.stringify(parseCSV('a,b\n1,2\n')));

// Test 4: Quoted fields with commas
console.log('Test 4:', JSON.stringify(parseCSV('a,"b,c",d\n1,"e,f",3')));

// Test 5: Quoted fields with newlines
console.log('Test 5:', JSON.stringify(parseCSV('a,"b\nc",d\n1,"e\nf",3')));

// Test 6: Escaped quotes
console.log('Test 6:', JSON.stringify(parseCSV('a,"b""c",d\n1,"e""f",3')));

// Test 7: Empty fields
console.log('Test 7:', JSON.stringify(parseCSV('a,,b\n1,,3')));

// Test 8: Spaces preserved
console.log('Test 8:', JSON.stringify(parseCSV('a, b , c\n1, 2 , 3')));

// Test 9: CRLF line endings
console.log('Test 9:', JSON.stringify(parseCSV('a,b\r\n1,2')));

// Test 10: Unclosed quote should throw SyntaxError
try {
  parseCSV('a,"b,c\n1,2');
  console.log('Test 10: FAILED - no error thrown');
} catch (e) {
  console.log('Test 10:', e.message);
}
