# byline-extraction

Scrapes configured pages for outbound article links, extracts the author (and email/social handles when published) from each news article, and appends rows to a Google Sheet via a Apps Script webhook.

The goal is to improve attribution to source authors by news aggregators.

In production, the scraper hits a news site one time per published citation. Limited retries, no spoofing.

## Setup

1. Create a Google sheet. 

2. Copy over the App Script code
   - Open Google Sheet → **Extensions → Apps Script** 
   - In the App Script UI, replace the default `Code.gs` with the contents of `apps-script/Code.gs` in this repo.  
   - Push the **Save Button** (a disc icon)  

3. Deploy the App Script
  
   3a. For a NEW App Script. In the Apps Script UI, the **sheet owner** does this: 
   - Deploy Button → New deployment → Web app
   - Execute as: Me
   - Who has access: Anyone with the link (it's ok, security is handled via a token)
   - Copy the deployment URL
   - Push deploy button

   3b. For an EXISTING App Script, sheet owner does this:
   - Deploy Button → **Manage deployment**
   - Pencil Icon to Edit
   - Version dropdown: **New Version**
   - Description: Name the version (ex: "v2") 
   - Push deploy button
 
4. Install the CLI 
   - `npm install` (requires npm) 

5. Rename `.env.example` to `.env` and paste the URL into `WEBHOOK_URL`.

6. Create the auth token as noted below. Add this in two places: `.env` and the App Script config.

7. Edit `config.json`. This is where you tell the scraper what to scrape.  
   - add URLS of page(s) to watch  
   - add link selector/pattern for each. You want to select content, not nav, using CSS classes (ex `.content a`). 

The Google Sheet deploy interface is wonky, so make sure you've actually saved, deployed and are on the correct version.

### How to create an auth token

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

To update to schema-breaking versions, easiest method is to delete the sheet and run the scrape again. 

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

Note: GitHub only fires cron from the default branch, but this repo's workflow checks out the `unbreaking` branch, where the live deployment config lives (main's `config.json` is a placeholder). If you fork this, point the checkout `ref` in `run.yml` at your own config branch, or remove it to run from main. If you keep a config branch, merge main into it after code changes — the cron runs that branch's code.

## License

MIT — see [LICENSE](LICENSE).
