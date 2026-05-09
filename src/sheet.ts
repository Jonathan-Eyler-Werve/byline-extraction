import { google, sheets_v4 } from "googleapis";
import type { ExtractionResult } from "./types.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export type SheetClient = {
  readSeenSourceUrls(): Promise<Set<string>>;
  appendRows(rows: ExtractionResult[]): Promise<void>;
};

const COLUMNS = [
  "author",
  "author_email",
  "source_url",
  "page_url",
  "title",
  "published_at",
  "extracted_at",
  "error",
] as const;

function rowFor(r: ExtractionResult): string[] {
  return [
    r.author,
    r.authorEmail ?? "",
    r.sourceUrl,
    r.pageUrl,
    r.title ?? "",
    r.publishedAt ?? "",
    new Date().toISOString(),
    r.error ?? "",
  ];
}

export async function makeSheetClient(opts: {
  spreadsheetId: string;
  tab: string;
}): Promise<SheetClient> {
  const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
  const sheets = google.sheets({ version: "v4", auth });
  await ensureHeaderRow(sheets, opts);
  return {
    readSeenSourceUrls: () => readSeenSourceUrls(sheets, opts),
    appendRows: (rows) => appendRows(sheets, opts, rows),
  };
}

async function ensureHeaderRow(
  sheets: sheets_v4.Sheets,
  opts: { spreadsheetId: string; tab: string },
) {
  const range = `${opts.tab}!A1:H1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.spreadsheetId,
    range,
  });
  const existing = res.data.values?.[0];
  if (!existing || existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: opts.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(COLUMNS)] },
    });
  }
}

async function readSeenSourceUrls(
  sheets: sheets_v4.Sheets,
  opts: { spreadsheetId: string; tab: string },
): Promise<Set<string>> {
  // source_url is column C (3rd)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.spreadsheetId,
    range: `${opts.tab}!C2:C`,
  });
  const values = res.data.values ?? [];
  return new Set(
    values
      .map((row) => row[0])
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );
}

async function appendRows(
  sheets: sheets_v4.Sheets,
  opts: { spreadsheetId: string; tab: string },
  rows: ExtractionResult[],
): Promise<void> {
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: opts.spreadsheetId,
    range: `${opts.tab}!A:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows.map(rowFor) },
  });
}
