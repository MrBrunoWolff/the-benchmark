export function parseCSV(text) {
  if (typeof text !== 'string') return [];
  if (text === '') return [];

  const rawRecords = splitIntoRecords(text);

  const result = [];
  for (const record of rawRecords) {
    result.push(splitRecord(record));
  }

  return result;
}

function splitIntoRecords(text) {
  const records = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (char === '\r') {
      if (i + 1 < text.length && text[i + 1] === '\n') {
        records.push(current);
        current = '';
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (char === '\n') {
      records.push(current);
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  if (current !== '') {
    records.push(current);
  }

  return records;
}

function splitRecord(record) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < record.length) {
    const char = record[i];

    if (char === '"') {
      if (inQuotes && i + 1 < record.length && record[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  if (inQuotes) {
    throw new SyntaxError('Unclosed quoted field');
  }

  fields.push(current);

  return fields;
}
