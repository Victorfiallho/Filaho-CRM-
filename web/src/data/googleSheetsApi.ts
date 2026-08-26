// Real Sheets API v4 read, used for the "private sheet" import path in
// ImportCenter.tsx — as opposed to the pre-existing published-CSV path
// (domain/googleSheets.ts's toGoogleSheetCsvUrl), which only works for
// sheets explicitly published to the web. `accessToken` comes from
// connectGoogleWorkspace(clientId, "sheets") (lib/googleOAuth.ts), which
// already requests the right `spreadsheets.readonly` scope.
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
