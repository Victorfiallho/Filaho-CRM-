export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (quoted && char === '"' && next === '"') { cell += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(v => v.trim())) rows.push(row);
      row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

// Inverse of parseCSV. Quotes a cell only when it holds a comma, quote or
// newline, like spreadsheet apps do. A cell starting with = + - @ (or a tab
// or CR) gets a leading ' so Excel/Sheets show it as text instead of running
// it as a formula: names typed on the public booking page end up in exports.
export function toCSV(headers: string[], rows: string[][]): string {
  const escapeCell = (raw: string) => {
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [headers, ...rows].map(row => row.map(escapeCell).join(",")).join("\r\n");
}
