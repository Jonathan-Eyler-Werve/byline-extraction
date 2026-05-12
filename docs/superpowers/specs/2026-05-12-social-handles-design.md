# Social-handle extraction — design

Date: 2026-05-12
Status: Approved, pending implementation
Branch: `feat/social-handles`
Research: `notes/social-handles-research.md`

## Goal

Extract author and organization social-media URLs from each scraped article page and persist them to four new columns in the sheet (`twitter`, `instagram`, `linkedin`, `bluesky`). The columns feed humans doing hand-crafted outreach — readable URLs, loose structure, no platform-canonicalization or author-vs-org filtering.

## Out of scope

- Off-page lookup (staff bio pages, X/LinkedIn profile pages). Bounded to whatever the article page itself shows.
- Mastodon, Threads, Facebook, YouTube, SoundCloud. Not seen in the research sample, not added now.
- Author-vs-org discrimination. Both go in the same column.
- Bare-handle normalization (`@username` form). Persist full URLs only.
- Migrating existing sheet rows. Sheet must be updated; see "Schema migration" below.
- aria-label discrimination (Fortune pattern) and plain-text bio parsing (Block Club pattern). Both deferred.

## Schema

Four columns inserted after `author_email`, before `source_url`. Final header:

| feed_title | author | author_email | **twitter** | **instagram** | **linkedin** | **bluesky** | source_url | page_url | title | published_at | extracted_at | error |

Each column holds a `; `-separated list of full URLs (matches the existing `citation_author` join convention). Empty when nothing found. Multi-author pages and pages with both author + org accounts all get merged into the same field.

Example: AP row's `twitter` column might be `https://twitter.com/mrbrownsir; https://twitter.com/AP`.

## Platform allowlist

The classifier maps host → column. Anything not on this list is dropped.

| Column | Hosts |
|---|---|
| `twitter` | `twitter.com`, `x.com` |
| `instagram` | `instagram.com` |
| `linkedin` | `linkedin.com` — only paths `/in/` and `/company/` (drop job postings, articles, share intents) |
| `bluesky` | `bsky.app` — only paths `/profile/` (drop `/intent/`) |

Hosts compared case-insensitively, with leading `www.` stripped.

## Share-intent denylist

Every URL is checked against this denylist before being recorded. Match if the URL **path** or **query** contains any of:

- `/intent/` (Twitter, Bluesky)
- `/share`, `/sharer.php` (Facebook share, generic)
- `intent/tweet`, `intent/compose`
- `shareArticle` (LinkedIn share endpoint)
- `?share=` (WordPress/Jetpack share param)

Also drop URLs with empty `href` (Capital & Main's `.mvp-twit-but` placeholder).

## Extraction sources

Two complementary sources, in order. Both feed the same per-platform `Set<string>` (deduped).

### 1. JSON-LD `sameAs`

Inside `tryJsonLd`, when walking the article node, extract `sameAs` from:
- Each `author` entry (Person or array of Person)
- The top-level `publisher` / `Organization` entry, if present

```typescript
function collectSameAs(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const same = obj.sameAs;
  if (typeof same === "string") return [same];
  if (Array.isArray(same)) return same.filter(s => typeof s === "string") as string[];
  return [];
}
```

Pass each URL through `classifySocial(url)` → returns `{ column, url } | null` after applying the allowlist + denylist. Push into per-column sets.

### 2. Byline-area anchor scan

Reuse the byline-region selector list from `tryCss` plus a few new ones the research surfaced:

```typescript
const BYLINE_AREAS = [
  // existing tryCss list:
  '[rel="author"]', '[itemprop="author"]', '.byline', '.author',
  // new for social extraction:
  '.Author-socialLinks',           // AP
  '.jeg_author_socials',           // Jegtheme (Capitol News IL)
  '.author-bio',                   // Newspack (Mission Local, Block Club, El Paso Matters)
  '.mvp-author-info-text',         // Capital & Main theme
  '.ArticlePage-authorInfo-bio',   // LAist
  '[class*="PostByline_author"]',  // LA Taco CSS modules — prefix match via attribute selector
  'address[class*=author]',
];
```

Inside each matched element, find `<a href>`. For each href, pass through `classifySocial` and accumulate.

## Architecture

### New module: `src/socials.ts`

```typescript
export type SocialColumn = "twitter" | "instagram" | "linkedin" | "bluesky";
export type SocialResult = Partial<Record<SocialColumn, string[]>>;

export function classifySocial(rawUrl: string): { column: SocialColumn; url: string } | null;
export function extractSocialsFromHtml(html: string): SocialResult;
```

`classifySocial` is the single source of truth for the host allowlist + path rules + share-intent denylist. Pure function, easy to test.

`extractSocialsFromHtml` orchestrates the two sources (JSON-LD + byline anchors), deduplicates per column, returns the per-column arrays.

### `src/types.ts` — extend `ExtractionResult`

```typescript
export type ExtractionResult = {
  // ... existing fields
  socials?: SocialResult;
};
```

### `src/extract.ts` — wire in

Call `extractSocialsFromHtml($)` once after the existing extractors and attach the result. Author-name extraction is untouched.

### `src/sheet.ts` — pass through to webhook

The webhook payload (`appendRows`) sends the full `ExtractionResult`; Apps Script `Code.gs` decides which fields land where. No type-side serialization needed.

### `apps-script/Code.gs` — header gate + column layout

```javascript
const COLUMNS = [
  "feed_title",
  "author",
  "author_email",
  "twitter",       // new
  "instagram",     // new
  "linkedin",      // new
  "bluesky",       // new
  "source_url",
  "page_url",
  "title",
  "published_at",
  "extracted_at",
  "error",
];
```

`ensureSheet_()` gains a header-integrity check:

```javascript
function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    return sheet;
  }
  // Validate existing header matches the expected schema.
  const headerWidth = Math.max(sheet.getLastColumn(), COLUMNS.length);
  const actualHeader = sheet.getRange(1, 1, 1, headerWidth).getValues()[0];
  for (let i = 0; i < COLUMNS.length; i++) {
    if (actualHeader[i] !== COLUMNS[i]) {
      throw new Error(
        "Sheet header mismatch at column " + (i + 1) +
        ". Expected '" + COLUMNS[i] + "', found '" + (actualHeader[i] || "") + "'. " +
        "Update the header row in the SOURCE sheet to match the current schema, " +
        "then retry."
      );
    }
  }
  return sheet;
}
```

The `try/catch` in `doGet`/`doPost` already maps thrown errors into `{ error: ... }` JSON responses; the CLI's webhook client surfaces those as `webhook seen failed:` / `webhook append failed:` runtime errors and aborts the run. That's the "fail loudly" behavior.

`rowToValues_` extends to populate the new columns:

```javascript
function rowToValues_(row) {
  const extractedAt = new Date().toISOString().slice(0, 10);
  const socials = row.socials || {};
  const join = function (arr) { return (arr || []).join("; "); };
  return [
    row.feedTitle || "",
    row.author || "",
    row.authorEmail || "",
    join(socials.twitter),
    join(socials.instagram),
    join(socials.linkedin),
    join(socials.bluesky),
    row.sourceUrl || "",
    row.pageUrl || "",
    row.title || "",
    row.publishedAt || "",
    extractedAt,
    row.error || "",
  ];
}
```

`readSeenUrls_` already computes `sourceUrlCol` and `errorCol` from `COLUMNS.indexOf(...)`, so it self-adjusts to the new positions. No change needed there.

## Manual migration steps (user-facing)

Document in README:

1. In the SOURCE sheet, open the header row.
2. Insert four new columns to the right of `author_email`, named: `twitter`, `instagram`, `linkedin`, `bluesky`.
3. Existing rows will show blank in those columns. The next CLI run will populate them for newly-extracted articles.

(No automated migration. The Apps Script will throw if the header doesn't match.)

## Testing

### New unit tests in `test/socials.test.ts`

`classifySocial`:
- `https://twitter.com/foo` → `{ column: "twitter", url: ... }`
- `https://x.com/foo` → `twitter`
- `https://www.x.com/foo` → `twitter` (www stripped)
- `https://twitter.com/intent/tweet?...` → `null` (share intent)
- `https://twitter.com/share` → `null`
- `https://linkedin.com/in/jane` → `linkedin`
- `https://linkedin.com/company/foo` → `linkedin`
- `https://linkedin.com/jobs/view/123` → `null` (wrong path)
- `https://linkedin.com/shareArticle?...` → `null`
- `https://bsky.app/profile/jane.bsky.social` → `bluesky`
- `https://bsky.app/intent/compose?...` → `null`
- `https://instagram.com/foo/` → `instagram`
- `https://facebook.com/foo` → `null` (not in allowlist)
- `https://example.com/anything` → `null`
- empty string → `null`

`extractSocialsFromHtml` against fixtures from the 4 ✅ sites:
- `apnews.html` → twitter and instagram each contain Matt Brown's profile **and** the AP org account
- `missionlocal.html` → instagram contains `byalicefinno`; twitter contains the org account
- `capitolnewsillinois.html` → twitter, linkedin, instagram all populated for Maggie Dougherty + org accounts
- `fortune.html` → twitter and linkedin contain Sydney Lake's profiles (org accounts also present)

Fixtures: trimmed-down HTML from `/tmp/social-research/*.html` saved to `test/fixtures/socials/<site>.html` — each file edited down to just the byline/JSON-LD region (keeps the repo lean).

Also one negative-case fixture:
- A page with only share-intent links and a publisher footer → all columns empty.

### Updated tests

- `test/extract.test.ts` — add one test confirming `extractAuthorFromHtml` returns a `socials` field when present, and omits it (or returns empty) when not.
- `test/run.test.ts` — existing assertions on `appended[0]` are `toMatchObject` calls that don't reference socials, so they keep passing. Optionally add one assertion that the socials field propagates through to the appended row.

## Acceptance

- `npm test` passes (existing + new tests).
- `npm run typecheck` clean.
- `npm run build` clean.
- New fixtures parse correctly and produce the expected per-platform sets.
- A live run against the production sheet, after the user adds the 4 columns, populates them for newly-extracted articles. A run against the **un-migrated** sheet returns a clear `Sheet header mismatch at column 4...` error and writes nothing.

## Edge cases / decisions baked in

- **Twitter ↔ X**: both land in the `twitter` column. No canonicalization.
- **`www.` prefix**: stripped from host for matching, preserved in stored URL.
- **Trailing slash on URL**: preserved as-is. Dedup is case-sensitive on path, so `instagram.com/foo` and `instagram.com/foo/` are separate entries. Acceptable noise; cleanup deferred.
- **Capitol News Illinois CMS bug** (`https://x.com/https://x.com/maggie_dough`): no repair attempt. URL is stored as-is; humans recognize it.
- **Empty result**: column is the empty string `""`, same as existing `author_email` empty handling.
- **JSON-LD malformed**: existing `tryJsonLd` swallows JSON parse errors and continues; same behavior applies here.
- **Author-vs-publisher mixing**: by design. The user reads these and picks.

## Future considerations (not implemented)

- aria-label discrimination for Fortune-style pages (+1 hit in research sample).
- Plain-text bio parsing (Block Club pattern).
- Bare-handle column (`@username` form) if/when the human emailer asks for it.
- Mastodon support if/when we see real handles.
- Off-page staff bio crawling (currently out of scope per project plan PII principle).
