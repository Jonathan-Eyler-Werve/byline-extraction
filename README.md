# byline-extraction

Scrapes configured pages for outbound article links, extracts the author (and email/social handles when published) from each news article, and appends rows to a Google Sheet via a Apps Script webhook.

The goal is to improve attribution to source authors by news aggregators.

In production, the scraper hits a news site one time per published citation. Limited retries, no spoofing.

## Setup

1. `npm install`
2. Open your target Google Sheet → **Extensions → Apps Script** → replace the default `Code.gs` with the contents of `apps-script/Code.gs` in this repo → **Save**. This is a manual copy/paste in the App Script UI.
3. In the Apps Script UI, the **sheet owner** has to deploy: 
   - **Deploy Button → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone with the link (security is handled via a token)
   - Copy the deployment URL.
4. Copy `.env.example` → `.env` and paste the URL into `WEBHOOK_URL`.
5. Create the auth token as noted below. 
6. Edit `config.json` to list the Organization pages to watch and the link selector/pattern for each.

The Google Sheet deploy interface is wonky, so make sure you've actually saved, deployed and are on the correct version.

### Required: shared-secret token

Every request must include `?token=<value>` matching the `TOKEN` Script Property. You'll set this in .env locally and within the Google Sheet.

To set it up:

1. Generate a string: `openssl rand -hex 16`
2. In Apps Script → **Project Settings → Script Properties → Add property**:
   - Property: `TOKEN`
   - Value: the generated string
3. In `.env`, set `WEBHOOK_TOKEN=<PUT-YOUR-TOKEN-HERE>`.

The CLI then appends `?token=<value>` to every request; the script rejects calls without a matching token.

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

To iterate on `linkSelector` / `linkPattern` without setting up a Google Sheet, pass `--dry-run`:

```bash
npx tsx src/cli.ts run --dry-run
```

### Quiet mode

Suppresses progress output; only the JSON summary prints on stdout. Useful for scripted or cron-driven runs:

```bash
node dist/cli.js run --quiet
```

### Retry errored rows

By default, URLs that failed extraction in a previous run are recorded in the sheet and skipped on subsequent runs. To re-attempt them after fixing a heuristic or when a site outage clears, pass `--retry-errors`:

```bash
node dist/cli.js run --retry-errors
```

The Apps Script replaces the existing row in place.

## Sheet schema

| feed_title | author | author_email | bluesky | instagram | linkedin | twitter | source_url | page_url | title | published_at | extracted_at | error |
|------------|--------|--------------|---------|-----------|----------|---------|------------|----------|-------|--------------|--------------|-------|

`source_url` (the article) is the dedup key. Failed extractions are stored as rows with `error` populated and `author=""`. Multi-author articles get all authors joined with `, ` or `; ` in the `author` column.

Social columns hold `; `-joined URLs (one per profile) extracted from each article page's JSON-LD `sameAs` and byline-area anchors. Author and publisher accounts are mixed in the same field — the humans reading the sheet do the disambiguation.

### Migrating an existing sheet

Versions before May 2026 used a 9-column schema (no social columns). If your deployment was set up before that, you'll need to add the four new columns:

1. In the SOURCE sheet, open the header row.
2. Insert four new columns to the right of `author_email`, named (in this order): `bluesky`, `instagram`, `linkedin`, `twitter`.
3. Existing rows will show blank in those columns; the next CLI run will populate them for newly-extracted articles.

The Apps Script refuses to write if the header doesn't match (`Sheet header mismatch at column N...`). After updating the header, retry.

## Privacy

Treat the Google Sheet as private data.

The output contains personal data (names; sometimes emails) about authors of articles linked. See `notes/project-plan.md`. Retention is enforced elsewhere: this v1 does not implement automated deletion.

The user agent passed to news sites identifies itself with a link to this GitHub project.

## Tests

```bash
npm test
```

## Scheduled runs (GitHub Actions)

`.github/workflows/run.yml` runs the CLI daily on a GitHub-hosted Ubuntu runner. To enable:

1. Add repo secrets at **Settings → Secrets and variables → Actions**: `WEBHOOK_URL` and `WEBHOOK_TOKEN` (same values as your local `.env`).
2. The workflow defaults to **14:13 UTC daily**. Edit the `cron:` line to change cadence.
3. A "Run workflow" button on the Actions tab triggers it manually for testing.

## License

MIT — see [LICENSE](LICENSE).
