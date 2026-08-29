// Minimal, dependency-free RFC4180 CSV reader/writer for the A00.3 offline pipeline. The A00
// product export (`product_catalog_exploration.csv`) embeds multi-line HTML descriptions and
// quoted commas, so a naive line-split reader is not safe here — this is a real state-machine parser.

export function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parses a CSV into an array of header-keyed records. Rows whose length doesn't match the header are dropped. */
export function parseCsvRecords(text: string): readonly Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  const records: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    if (row.length !== header.length) continue;
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      record[header[i]!] = row[i]!;
    }
    records.push(record);
  }
  return records;
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function writeCsv(columns: readonly string[], rows: readonly Record<string, string | number | boolean | null | undefined>[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
