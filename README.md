# byline-extraction

Scrapes configured Organization pages for outbound article links, extracts the author (and email when published) from each new article, and appends rows to a Google Sheet via a tiny Apps Script webhook.

The goal of the app is to improve attribution to source authors by news aggregators.

In production, the scraper hits a news site one time per published citation. Limited retries, no spoofing.

## Setup

1. `npm install`
2. Open your target Google Sheet → **Extensions → Apps Script** → replace the default `Code.gs` with the contents of `apps-script/Code.gs` in this repo → **Save**. This is a manual copy/paste in the App Script UI.
3. **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone with the link (or "Anyone within `<your-domain>`" if available and you want it scoped)
   - Copy the deployment URL.
4. Copy `.env.example` → `.env` and paste the URL into `WEBHOOK_URL`.
5. Edit `config.json` to list the Organization pages to watch and the link selector/pattern for each.

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

By default, URLs that failed extraction in a previous run are recorded in the sheet (with `error` populated and `author=""`) and skipped on subsequent runs. To re-attempt them after fixing a heuristic or when a site outage clears, pass `--retry-errors`:

```bash
node dist/cli.js run --retry-errors
```

The Apps Script replaces the existing row in place — no duplicates.

## Sheet schema

| feed_title | author | author_email | source_url | page_url | title | published_at | extracted_at | error |
|------------|--------|--------------|------------|----------|-------|--------------|--------------|-------|

`source_url` (the article) is the dedup key. Failed extractions are stored as rows with `error` populated and `author=""`. Multi-author articles get all authors joined with `, ` in the `author` column.

## Privacy

Treat the Google Sheet as private data.

The output contains personal data (names; sometimes emails) about authors of articles linked. See `notes/project-plan.md`. Retention is enforced out-of-band: this v1 does not implement automated deletion.

The user agent passed to news sites identifies itself with a link to the GitHub project.

## Tests

```bash
npm test
```
