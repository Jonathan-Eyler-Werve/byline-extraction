// byline-extraction webhook — paste this into Apps Script in your sheet
// (Extensions → Apps Script → replace the default Code.gs contents → Save).
//
// Then: Deploy → New deployment → type "Web app".
//   Execute as:    Me
//   Who has access: Anyone with the link
// Copy the URL — that's the WEBHOOK_URL the CLI needs.
//
// REQUIRED: in Project Settings → Script Properties, add a property named
// TOKEN with a long random value (e.g. `openssl rand -hex 16`). The script
// rejects every request without a matching ?token= parameter; without
// TOKEN set, all requests fail. Put the same value in the CLI's
// WEBHOOK_TOKEN env var.

const SHEET_NAME = "Sheet1";
const COLUMNS = [
  "feed_title",
  "author",
  "author_email",
  "source_url",
  "page_url",
  "title",
  "published_at",
  "extracted_at",
  "error",
];

function doGet(request) {
  try {
    if (!checkAuth_(request)) return jsonResponse_({ error: "unauthorized" });
    const op = request.parameter.op;
    if (op === "seen") {
      const excludeErrors = request.parameter.excludeErrors === "1";
      const urls = readSeenUrls_(ensureSheet_(), excludeErrors);
      return jsonResponse_({ urls: urls });
    }
    return jsonResponse_({ error: "unknown op: " + op });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function doPost(request) {
  try {
    if (!checkAuth_(request)) return jsonResponse_({ error: "unauthorized" });
    const body = JSON.parse(request.postData.contents);
    if (body.op !== "append") {
      return jsonResponse_({ error: "unknown op: " + body.op });
    }
    const rows = body.rows || [];
    if (rows.length === 0) return jsonResponse_({ appended: 0, updated: 0 });
    const result = upsertRows_(ensureSheet_(), rows);
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function readSeenUrls_(sheet, excludeErrors) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const sourceUrlCol = COLUMNS.indexOf("source_url") + 1;
  const errorCol = COLUMNS.indexOf("error") + 1;
  const startCol = Math.min(sourceUrlCol, errorCol);
  const numCols = Math.abs(errorCol - sourceUrlCol) + 1;
  const values = sheet.getRange(2, startCol, lastRow - 1, numCols).getValues();
  const sourceOffset = sourceUrlCol - startCol;
  const errorOffset = errorCol - startCol;

  return values
    .filter(function (row) {
      if (excludeErrors && row[errorOffset]) return false;
      return typeof row[sourceOffset] === "string" && row[sourceOffset].length > 0;
    })
    .map(function (row) { return row[sourceOffset]; });
}

function upsertRows_(sheet, rows) {
  // Build map of existing source_url -> 1-based row index so we can upsert.
  const sourceUrlCol = COLUMNS.indexOf("source_url") + 1;
  const lastRow = sheet.getLastRow();
  const existingByUrl = {};
  if (lastRow >= 2) {
    const existingValues = sheet.getRange(2, sourceUrlCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < existingValues.length; i++) {
      const cellValue = existingValues[i][0];
      if (typeof cellValue === "string" && cellValue.length > 0) {
        existingByUrl[cellValue] = i + 2;
      }
    }
  }

  const appendValues = [];
  let updatedCount = 0;
  for (const row of rows) {
    const rowValues = rowToValues_(row);
    const existingRowIndex = existingByUrl[row.sourceUrl];
    if (existingRowIndex) {
      sheet.getRange(existingRowIndex, 1, 1, COLUMNS.length).setValues([rowValues]);
      updatedCount++;
    } else {
      appendValues.push(rowValues);
    }
  }
  if (appendValues.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appendValues.length, COLUMNS.length).setValues(appendValues);
  }
  return { appended: appendValues.length, updated: updatedCount };
}

function rowToValues_(row) {
  // extracted_at as calendar date only (YYYY-MM-DD, UTC) so the column is
  // clusterable by day in the sheet without per-cell timestamp noise.
  const extractedAt = new Date().toISOString().slice(0, 10);
  return [
    row.feedTitle || "",
    row.author || "",
    row.authorEmail || "",
    row.sourceUrl || "",
    row.pageUrl || "",
    row.title || "",
    row.publishedAt || "",
    extractedAt,
    row.error || "",
  ];
}

function checkAuth_(request) {
  // Every request must include ?token=<value> matching the TOKEN value
  // stored in Project Settings → Script Properties. If TOKEN is not set
  // on the script, all requests are rejected — secure by default. To
  // enable the webhook, set TOKEN to a long random string and put the
  // same value in the caller's WEBHOOK_TOKEN env var.
  const expected = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!expected) return false;
  return request && request.parameter && request.parameter.token === expected;
}

function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
