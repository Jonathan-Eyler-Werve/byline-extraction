# Byline Extraction — Design

**Date:** 2026-05-09
**Status:** Draft, pending review

## Goal

A small Node/TypeScript CLI that, when run manually, scrapes a configured set of HTML "feed" pages for outbound article links, extracts the author from each new article, and appends the result to a Google Sheet.

## Non-goals (v1)

- No scheduling (cron/launchd/daemon). Run is manual.
- No LLM-based extraction. Heuristics only; an off-the-shelf library is allowed if one fits well.
- No retry logic. Failed extractions are recorded as rows with an error message; not retried.
- No web UI, no HTTP API.

## Architecture

Single Node/TypeScript package. One command: `byline run`. Three internal modules plus a CLI entry point and a config loader.

```
┌──────────┐   urls   ┌──────────┐  rows  ┌──────────┐
│  feeds   │ ───────▶ │ extract  │ ─────▶ │  sheet   │
└──────────┘          └──────────┘        └──────────┘
     ▲                                          │
     │              dedup (seen urls)           │
     └──────────────────────────────────────────┘
```

## Constraints

Analysis of article pages is hueristic, or using hueristic libraries. No LLM. No entity extraction model unless bundled in widely used library and run locally.

### Modules

- **`feeds.ts`** — `findLinks(pageUrl, options): Promise<string[]>`
  Fetches an Organization page (HTML), returns absolute outbound article URLs (these become `sourceUrl` values). `options` may include a CSS selector for which `<a>` elements count as articles, defaulting to all `<a>` whose href matches a per-feed regex.

- **`extract.ts`** — `extractAuthor(sourceUrl): Promise<Omit<ExtractionResult, "pageUrl">>`
  Fetches an article (the `sourceUrl`) and returns the byline fields. The orchestrator merges in `pageUrl` (the Organization page where the article was linked from). Returns:
  ```ts
  type ExtractionResult = {
    sourceUrl: string;       // the article URL (the source of the byline)
    author: string;          // "" if not found
    authorEmail?: string;    // only if published on the article page
    pageUrl: string;         // the Organization page the article was linked from
    title?: string;
    publishedAt?: string;    // ISO 8601
    error?: string;          // populated on failure
  }
  ```
  Heuristic order for author name:
  1. JSON-LD `schema.org/Article` `author` field
  2. `<meta name="author">` and OpenGraph `article:author`
  3. Common CSS selectors (`.byline`, `[rel="author"]`, etc.)
  4. If a vetted library (e.g. `@extractus/article-extractor`) handles all of the above cleanly, use it instead of hand-rolled selectors. Decision made during implementation.

  Heuristic for author email (best-effort; often absent):
  1. `mailto:` links inside or adjacent to the byline element
  2. JSON-LD `author.email` if present
  3. Email-shaped text within the byline element. Skip generic addresses (`info@`, `editor@`, etc.).
  Empty string when not found on the page. Do NOT attempt to look up emails off-page (e.g. via a separate author bio page) in v1.

- **`sheet.ts`** — `readSeenSourceUrls(): Promise<Set<string>>` and `appendRows(rows: ExtractionResult[]): Promise<void>`
  Thin wrapper over `googleapis` Sheets v4. Reads the `source_url` column for dedup; appends new rows.

- **`run.ts`** — orchestrator. Reads seen URLs, iterates configured feeds, diffs, extracts authors per-URL with try/catch, appends results.

- **`cli.ts`** — argv parsing (e.g. `commander` or hand-rolled), invokes `run`.

- **`config.ts`** — loads and validates the config file.

## Configuration

A `config.json` at the repo root:

```json
{
  "feeds": [
    {
      "pageUrl": "https://example.com/news",
      "linkSelector": "a.article-link",
      "linkPattern": "^https://other-site\\.com/articles/\\d+/"
    }
  ]
}
```

Each `feeds[].pageUrl` is an Organization page that lists outbound articles. `linkSelector` and `linkPattern` are both optional; at least one should be provided.

Environment variables (loaded via `dotenv`):

- `GOOGLE_SHEET_ID` — target sheet ID
- `GOOGLE_SHEET_TAB` — tab/range name (default: `Sheet1`)
- `GOOGLE_APPLICATION_CREDENTIALS` — path to service-account JSON (the SA email must be shared into the target sheet with edit permission)

## Sheet schema

A single tab. Header row:

| author | author_email | source_url | page_url | title | published_at | extracted_at | error |
|--------|--------------|------------|----------|-------|--------------|--------------|-------|

`source_url` (the article) is the dedup key. `extracted_at` is set to the ISO timestamp at append time. `error` is populated only when extraction failed.

## Data flow (single run)

1. Load `config.json` and env vars.
2. Authenticate to Google Sheets via service-account.
3. `seen = await readSeenSourceUrls()`.
4. For each feed in config:
   a. `sourceUrls = await findLinks(feed.pageUrl, feed)`.
   b. `newSourceUrls = sourceUrls.filter(u => !seen.has(u))`.
   c. For each new `sourceUrl`, call `extractAuthor(sourceUrl)` inside a try/catch and merge `pageUrl: feed.pageUrl` into the result. On throw, build an `ExtractionResult` with `error` set and `author = ""`.
   d. Collect results.
5. `await appendRows(allResults)` in one batch call.
6. Print a summary: feeds scanned, new links found, successes, failures.

## Error handling

- **Per-URL extraction errors** — caught, logged, written as a row with `error` populated and `author = ""`. Run continues.
- **Sheet auth / API errors** — halt the run with a non-zero exit code; nothing useful to do without sheet access.
- **Feed fetch errors** — log, skip that feed, continue with the others. Final summary reports it.
- **Network timeouts** — per-request timeout (e.g. 15s for feeds, 30s for articles). Treat as the error cases above.

## Testing

- **Framework:** Vitest.
- **Fixtures:** HTML snapshots of real feed pages and articles, committed to `test/fixtures/`. Refresh manually when sources change.
- **Unit tests:**
  - `feeds.test.ts` — `findLinks` against fixture HTML for each configured feed.
  - `extract.test.ts` — `extractAuthor` against fixture HTML covering each heuristic tier (JSON-LD, meta, CSS, missing author).
- **Mocked sheet:** `sheet.ts` is mocked in unit tests via `vi.mock`.
- **Optional integration test:** one test that hits a throwaway Google Sheet, gated by `RUN_INTEGRATION_TESTS=1`. Not run in default `npm test`.

## File layout

```
src/
  feeds.ts
  extract.ts
  sheet.ts
  run.ts
  cli.ts
  config.ts
test/
  fixtures/
  feeds.test.ts
  extract.test.ts
config.json          # committed; contains no secrets
.env                 # gitignored; sheet ID + creds path
package.json
tsconfig.json
vitest.config.ts
```

## Open questions (resolved during implementation)

- **Article-extraction library vs. hand-rolled selectors.** Evaluate `@extractus/article-extractor` and similar against the fixture set. Pick the path with better accuracy on the feeds in `config.json`. If neither is clearly better, prefer hand-rolled (fewer dependencies).
- **HTTP client.** `undici` (built into Node) vs. `node-fetch`. Default to `undici`.

## PII / data handling

The output contains personal data (names; sometimes emails) collected from public pages and associated with The Organization. See `notes/project-plan.md` § Adverse impacts for the threat model and mitigations. Concrete obligations on this codebase:

- The sheet must store only the columns above — no extra metadata that could broaden the profile (e.g. social handles, bios) without a fresh review.
- Generic shared mailboxes (`info@`, `editor@`, `tips@`, `news@`, `contact@`) are not written to `author_email`.
- The code does not retrieve content beyond the configured feed pages and the article URLs they link to. No follow-on fetching of author bio pages, social profiles, etc., in v1.
- Retention policy is defined and enforced outside this codebase (sheet ACLs, periodic deletion). v1 does not implement automated deletion; document this gap in the README and reference the plan's mitigations.

## Out of scope (deferred)

- Scheduling / daemon mode.
- Resumability beyond what the sheet provides.
- Multi-author articles (v1: first author wins; document this behavior).
- Retry logic for transient failures.
- Rate limiting / politeness delays beyond a simple per-request `await sleep(N)` if a feed needs it.
- Automated PII retention / deletion (handled out-of-band per project plan).
- Email outreach to authors (out of scope per project plan — assumes a human handles outreach).
