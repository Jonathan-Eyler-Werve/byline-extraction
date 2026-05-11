// byline-extraction webhook — paste this into Apps Script in your sheet
// (Extensions → Apps Script → replace the default Code.gs contents → Save).
//
// Then: Deploy → New deployment → type "Web app".
//   Execute as:    Me
//   Who has access: Anyone with the link
// Copy the URL — that's the WEBHOOK_URL the CLI needs.

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
      const sheet = ensureSheet_();
      const lastRow = sheet.getLastRow();
      let urls = [];
      if (lastRow >= 2) {
        const sourceUrlCol = COLUMNS.indexOf("source_url") + 1;
        const errorCol = COLUMNS.indexOf("error") + 1;
        const excludeErrors = request.parameter.excludeErrors === "1";
        const startCol = Math.min(sourceUrlCol, errorCol);
        const numCols = Math.abs(errorCol - sourceUrlCol) + 1;
        const range = sheet.getRange(2, startCol, lastRow - 1, numCols);
        const values = range.getValues();
        const sourceOffset = sourceUrlCol - startCol;
        const errorOffset = errorCol - startCol;
        urls = values
          .filter(function (row) {
            if (excludeErrors && row[errorOffset]) return false;
            return typeof row[sourceOffset] === "string" && row[sourceOffset].length > 0;
          })
          .map(function (row) { return row[sourceOffset]; });
      }
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
    const sheet = ensureSheet_();

    // Build map of existing source_url -> 1-based row index so we can upsert.
    const sourceUrlCol = COLUMNS.indexOf("source_url") + 1;
    const lastRow = sheet.getLastRow();
    const existingByUrl = {};
    if (lastRow >= 2) {
      const existingRange = sheet.getRange(2, sourceUrlCol, lastRow - 1, 1);
      const existingValues = existingRange.getValues();
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
      const ts = new Date().toISOString();
      const rowValues = [
        row.feedTitle || "",
        row.author || "",
        row.authorEmail || "",
        row.sourceUrl || "",
        row.pageUrl || "",
        row.title || "",
        row.publishedAt || "",
        ts,
        row.error || "",
      ];
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
    return jsonResponse_({ appended: appendValues.length, updated: updatedCount });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
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
