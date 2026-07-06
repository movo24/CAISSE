/**
 * Minimal dependency-free CSV (RFC-4180) parser + serializer.
 *
 * - Fields may be quoted with `"`; a literal quote inside a quoted field is
 *   doubled (`""`). Quoted fields may contain commas and newlines.
 * - Accepts both LF and CRLF line endings on parse; emits CRLF on serialize.
 * - parseCsv returns rows of raw string cells (no header interpretation).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++; // swallow CR; the LF (or EOF) ends the row
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // trailing field/row when the text does not end with a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Serialize rows to CSV (CRLF line endings, minimal quoting). */
export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const esc = (v: string | number | boolean | null | undefined): string => {
    const isStr = typeof v === 'string';
    let s = v == null ? '' : String(v);
    // CSV formula-injection guard (CWE-1236): a STRING cell a spreadsheet would read
    // as a formula (=, +, -, @, tab, CR) is prefixed with an apostrophe so opening the
    // export in Excel/Sheets can't execute it. Numbers/booleans are left intact (a
    // negative number must stay a number), so numeric columns round-trip unchanged.
    if (isStr && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/**
 * Inverse of the formula-injection guard in toCsv: strip a single leading apostrophe
 * that precedes a formula-trigger char, so an export→import round-trip is lossless for
 * names like "-40% Promo" / "@Home". Apply per-field on import (M105 round-trip fix).
 */
export function stripFormulaGuard(s: string): string {
  return s.replace(/^'(?=[=+\-@\t\r])/, '');
}

/**
 * Parse a CSV with a header row into objects keyed by header name.
 * Fully-empty rows are dropped. Header cells are trimmed.
 */
export function parseCsvWithHeader(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue; // skip blank lines
    const obj: Record<string, string> = {};
    header.forEach((key, idx) => {
      obj[key] = (cells[idx] ?? '').trim();
    });
    out.push(obj);
  }
  return out;
}
