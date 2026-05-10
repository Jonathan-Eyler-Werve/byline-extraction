// byline-extraction webhook — paste this into Apps Script in your sheet
// (Extensions → Apps Script → replace the default Code.gs contents → Save).
//
// Then: Deploy → New deployment → type "Web app".
//   Execute as:    Me
//   Who has access: Anyone with the link
// Copy the URL — that's the WEBHOOK_URL the CLI needs.

const SHEET_NAME = "Sheet1";
const COLUMNS = [
  "author",
  "author_email",
  "source_url",
  "page_url",
  "title",
  "published_at",
  "extracted_at",
  "error",
];

function doGet(e) {
  try {
    const op = e.parameter.op;
    if (op === "seen") {
      const sheet = ensureSheet_();
      const lastRow = sheet.getLastRow();
      let urls = [];
      if (lastRow >= 2) {
        const sourceUrlCol = COLUMNS.indexOf("source_url") + 1;
        const range = sheet.getRange(2, sourceUrlCol, lastRow - 1, 1);
        urls = range.getValues().flat().filter(function (v) {
          return typeof v === "string" && v.length > 0;
        });
      }
      return jsonResponse_({ urls: urls });
    }
    return jsonResponse_({ error: "unknown op: " + op });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.op !== "append") {
      return jsonResponse_({ error: "unknown op: " + body.op });
    }
    const rows = body.rows || [];
    if (rows.length === 0) return jsonResponse_({ appended: 0 });
    const sheet = ensureSheet_();
    const values = rows.map(function (r) {
      const ts = new Date().toISOString();
      return [
        r.author || "",
        r.authorEmail || "",
        r.sourceUrl || "",
        r.pageUrl || "",
        r.title || "",
        r.publishedAt || "",
        ts,
        r.error || "",
      ];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, COLUMNS.length).setValues(values);
    return jsonResponse_({ appended: values.length });
  } catch (err) {
    return jsonResponse_({ error: String(err) });
  }
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
