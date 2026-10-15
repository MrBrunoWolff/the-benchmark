export function parseCSV(text) {
  if (!text || text === '') return [];

  const records = [];
  let currentRecord = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = true;
          // Push the completed field before entering quotes
          if (currentField !== '') {
            currentRecord.push(currentField);
            currentField = '';
          }
        }
      } else if (char === ',') {
        currentRecord.push(currentField);
        currentField = '';
      } else if (char === '\n') {
        currentRecord.push(currentField);
        records.push(currentRecord);
        currentRecord = [];
        currentField = '';
      } else if (char === '\r') {
        // CRLF line ending
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        currentRecord.push(currentField);
        records.push(currentRecord);
        currentRecord = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
    i++;
  }

  // Push the last field of the final record
  if (currentField !== '') {
    currentRecord.push(currentField);
  }

  records.push(currentRecord);

  // Remove trailing empty record caused by a trailing newline
  if (records.length > 0 && records[records.length - 1].length === 0) {
    records.pop();
  }

  return records;
}
