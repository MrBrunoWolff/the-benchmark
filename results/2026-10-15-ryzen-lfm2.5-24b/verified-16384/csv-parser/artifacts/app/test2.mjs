import { parseCSV } from './csv.mjs';

// Multiple consecutive newlines (empty records)
const t1 = parseCSV('a\n\nb');
console.log('Empty line:', JSON.stringify(t1));

// Quoted field with newline inside
const t2 = parseCSV('a,"b\nc",d');
console.log('Quoted newline:', JSON.stringify(t2));

// Multiple quoted fields
const t3 = parseCSV('"x","y","z"');
console.log('Multiple quoted:', JSON.stringify(t3));

// Mixed: quoted and unquoted
const t4 = parseCSV('a,"b,c",d,e');
console.log('Mixed:', JSON.stringify(t4));
