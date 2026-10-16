import assert from 'node:assert/strict';
import { createChecks } from './check-runner.mjs';
const { check, finish } = createChecks();
import { parseCSV } from '/app/csv.mjs';
const cases=[['',[]],['a,b\nc,d',[['a','b'],['c','d']]],['a,b\r\nc,d\r\n',[['a','b'],['c','d']]],['"hello, world",x',[['hello, world','x']]],['"say ""hi""",y',[['say "hi"','y']]],['"line1\nline2",z',[['line1\nline2','z']]],['a,,',[['a','','']]],['a,b\n',[['a','b']]],[' ,"",x',[[' ','','x']]],['"a\r\nb",c',[['a\r\nb','c']]],['""',[['']]],['\n',[['']]]];
const labels = ['Empty input', 'Comma-separated records', 'CRLF records and trailing separator', 'Quoted comma', 'Escaped double quotes', 'Quoted LF newline', 'Trailing empty fields', 'No extra row after trailing newline', 'Spaces and empty quoted fields', 'Quoted CRLF newline', 'Single empty quoted field', 'Single empty record'];
for (const [index, [input, expected]] of cases.entries()) {
  check(`csv-${index + 1}`, labels[index], () => assert.deepEqual(parseCSV(input), expected));
}
check('unclosed-quote', 'Reject unclosed quoted field', () => assert.throws(() => parseCSV('"unclosed'), SyntaxError));
finish();
