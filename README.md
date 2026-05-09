# byline-extraction

Scrapes configured Organization pages for outbound article links, extracts the author (and email when published) from each new article, and appends rows to a Google Sheet.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, and `GOOGLE_APPLICATION_CREDENTIALS` (path to a service-account JSON key).
3. Share the target sheet with the service-account email (Editor access).
4. Edit `config.json` to list the Organization pages to watch and the link selector/pattern for each.

## Run

```bash
npm run build
node dist/cli.js run
```

Or in dev:

```bash
npx tsx src/cli.ts run
```

### Dry run

To iterate on `linkSelector` / `linkPattern` without setting up Sheets credentials, pass `--dry-run`:

```bash
npx tsx src/cli.ts run --dry-run
```

This skips both reading and writing the sheet (so all matched links count as "new"), and prints the rows that *would* have been appended. No `GOOGLE_*` env vars required.

## Sheet schema

| author | author_email | source_url | page_url | title | published_at | extracted_at | error |
|--------|--------------|------------|----------|-------|--------------|--------------|-------|

`source_url` (the article) is the dedup key. Failed extractions are stored as rows with `error` populated and `author=""`. For multi-author articles, v1 records only the first author.

## Privacy

The output contains personal data (names; sometimes emails) about authors of articles linked by the Organization. See `notes/project-plan.md` § Adverse impacts for the threat model. Retention is enforced out-of-band: this v1 does not implement automated deletion.

## Tests

```bash
npm test
```
