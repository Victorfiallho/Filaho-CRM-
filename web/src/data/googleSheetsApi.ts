// Reads a private Google Sheet with the Sheets API v4 (Import Center). Public
// sheets use the published-CSV path in domain/googleSheets.ts instead.
// `accessToken` comes from connectGoogleWorkspace(clientId, "sheets").
export async function fetchPrivateSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range = "A1:Z1000"
): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `Sheets API request failed (${res.status})`);
  }
  const data = await res.json();
  return (data.values || []) as string[][];
}
