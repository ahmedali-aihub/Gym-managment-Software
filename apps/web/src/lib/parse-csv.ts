/**
 * A correct CSV reader.
 *
 * `line.split(',')` is the obvious approach and it silently corrupts real
 * data: an address like `"12-3, Main Road"` becomes two columns, every
 * later field shifts left by one, and phone numbers end up in the email
 * column. On 6,500 rows nobody notices until a member complains.
 *
 * This handles the three things that actually occur in spreadsheet exports:
 * quoted fields containing commas, doubled quotes as an escape (`""`), and
 * newlines inside a quoted field.
 */

export interface CsvResult {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export function parseCsv(text: string): CsvResult {
  // Excel writes a UTF-8 BOM, which otherwise becomes part of the first
  // header name and stops it matching any known column.
  const clean = text.replace(/^﻿/, '');

  const table = parseRows(clean);
  if (table.length === 0) return { headers: [], rows: [] };

  const headers = (table[0] ?? []).map((h) => h.trim());

  const rows = table
    .slice(1)
    // Trailing blank lines are normal at the end of an export.
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = (cells[index] ?? '').trim();
      });
      return row;
    });

  return { headers, rows };
}

/** Split the whole document into rows of cells, respecting quotes. */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      // Windows writes \r\n; consume both as one break.
      if (char === '\r' && text[i + 1] === '\n') i++;
      cells.push(value);
      rows.push(cells);
      cells = [];
      value = '';
    } else {
      value += char;
    }
  }

  // The last row has no trailing newline.
  if (value !== '' || cells.length > 0) {
    cells.push(value);
    rows.push(cells);
  }

  return rows;
}
