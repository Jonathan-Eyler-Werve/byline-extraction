# byline-extraction

Scrapes configured Organization pages for outbound article links, extracts the author (and email when published) from each new article, and appends rows to a Google Sheet via a tiny Apps Script webhook.

## Setup

1. `npm install`
2. Open your target Google Sheet → **Extensions → Apps Script** → replace the default `Code.gs` with the contents of `apps-script/Code.gs` in this repo → **Save**.
3. **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone with the link (or "Anyone within `<your-domain>`" if available and you want it scoped)
   - Copy the deployment URL.
4. Copy `.env.example` → `.env` and paste the URL into `WEBHOOK_URL`.
5. Edit `config.json` to list the Organization pages to watch and the link selector/pattern for each.

No GCP project, service account, or `googleapis` library required — the Apps Script runs as you (the sheet owner) and the URL is the only secret.

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

`source_url` (the article) is the dedup key. Failed extractions are stored as rows with `error` populated and `author=""`. Multi-author articles get all authors joined with `, ` in the `author` column.

## Privacy

The output contains personal data (names; sometimes emails) about authors of articles linked by the Organization. See `notes/project-plan.md` § Adverse impacts for the threat model. Retention is enforced out-of-band: this v1 does not implement automated deletion.

## Tests

```bash
npm test
```
