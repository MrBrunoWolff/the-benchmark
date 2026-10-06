#!/bin/bash
set -euo pipefail
cat > /app/csv.mjs <<'REFERENCE_SOLUTION'
export function parseCSV(text) {
 if (!text.length) return [];
 const rows=[]; let row=[], field='', quoted=false;
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(c==='"') { if(quoted&&text[i+1]==='"') {field+='"';i++;} else quoted=!quoted; }
  else if(!quoted&&c===',') {row.push(field);field='';}
  else if(!quoted&&(c==='\n'||c==='\r')) {row.push(field);rows.push(row);row=[];field='';if(c==='\r'&&text[i+1]==='\n')i++;}
  else field+=c;
 }
 if(quoted) throw new SyntaxError('Unclosed quote');
 if(field.length||row.length||!/[\r\n]$/.test(text)) {row.push(field);rows.push(row);}
 return rows;
}
REFERENCE_SOLUTION
