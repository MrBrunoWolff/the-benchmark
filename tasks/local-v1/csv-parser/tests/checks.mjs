import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { parseCSV } from '/app/csv.mjs';
const cases=[['',[]],['a,b\nc,d',[['a','b'],['c','d']]],['a,b\r\nc,d\r\n',[['a','b'],['c','d']]],['"hello, world",x',[['hello, world','x']]],['"say ""hi""",y',[['say "hi"','y']]],['"line1\nline2",z',[['line1\nline2','z']]],['a,,',[['a','','']]],['a,b\n',[['a','b']]],[' ,"",x',[[' ','','x']]],['"a\r\nb",c',[['a\r\nb','c']]],['""',[['']]],['\n',[['']]]];
for(const [input,expected] of cases) assert.deepEqual(parseCSV(input),expected);
assert.throws(()=>parseCSV('"unclosed'),SyntaxError);
console.log('All functional checks passed');
