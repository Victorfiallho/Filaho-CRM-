export function toGoogleSheetCsvUrl(url: string): string {
  if (!url) return "";
  if (url.includes("output=csv") || url.endsWith(".csv")) return url;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (idMatch) {
    const gid = (url.match(/[?&#]gid=(\d+)/) || [null, "0"])[1];
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
  }
  return url;
}

// The bare spreadsheet id, for the Sheets API (private sheet import).
export function extractSpreadsheetId(url: string): string | null {
  return url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || null;
}
