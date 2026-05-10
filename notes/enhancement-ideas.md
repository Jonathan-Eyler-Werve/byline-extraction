# Enhancement Ideas

Ranked by my read on value-vs-effort for this tool. Not a roadmap — pick what's useful.

## High value, small lift

### Author-name denylist
Real-world data showed `admin`, `adminK`, `Editorial Team`, etc. landing in the `author` column. Mirror the existing `GENERIC_MAILBOX_LOCAL_PARTS` set with a `GENERIC_AUTHOR_NAMES` set in `extract.ts` and short-circuit those to `""`. ~10 lines + a test. Same shape as the email filter.

### Length cap on extracted author
Cap the author name at, say, 80 chars; if longer, treat as no-author. Catches the "My Name is Mike and I'd Rather be Surfing." class of tagline-as-byline. Prevents overlong values from making the sheet ugly. ~3 lines.

### Live progress output
Right now the CLI is silent until the final JSON summary, which is rough when a run takes 30+ seconds extracting 25 articles — you can't tell if it's working, hanging, or stuck on one slow site. Better UX:

- Per-feed start line: `Scanning https://example.org/news... 26 links found, 4 new`
- Per-URL line as each extract resolves: `[3/4] ✓ Sarah Ogilvie — "The rise of the broligarchy"` or `[3/4] ✗ fetch failed: 403 — https://...`
- Final summary stays as JSON (so it's still pipe-able)

Behind a default-on flag with `--quiet` for the script-friendly mode (only the summary JSON). Probably 30 minutes of work in `run.ts` — pass an optional `onProgress` callback through `RunOptions`, wire it from `cli.ts`. Doesn't change any tests.

### `--feed <pageUrl>` flag
Let me run a single feed from `config.json` instead of the whole list. Useful when iterating on selectors for one source. Also pairs well with `--dry-run`.

### Vitest 2 → 4 bump
Clears the dev-only esbuild CVEs that the production-ready audit flagged. Some test-API churn possible but vitest's 2→4 has been low-friction in practice. ~1 hour incl. fixing anything that breaks.

## Medium

### Per-feed politeness delay
Add an optional `delayMs` to each feed config; sleep between article fetches for that feed. Keeps us friendly on small publishers we'd hit repeatedly. Default unset (no delay).

### Custom User-Agent
Right now we send Node's default UA. Some sites block it with 403 (we saw this with `surfertoday.com`, `barefootsurftravel.com`). A polite UA like `byline-extraction/0.1 (+contact url)` won't fix all blocks but reduces some.

### Per-feed `ignoreHosts` list
Empirically, ~20% of outbound article links from a typical Organization page go to publications that 401/403 from any non-browser client (NYT, WSJ, Reuters, Bloomberg, Politico, surfertoday.com, etc. — DataDome / PerimeterX / Akamai bot managers). These are unrecoverable without a real headless browser. Add an optional `ignoreHosts: ["nytimes.com", "wsj.com", ...]` per feed so we skip them upfront — reduces noise in the progress output and saves the per-URL fetch round trip. Failed rows still show up if you want to handle them manually; the ignore list is for known-impossible cases. ~20 lines.

### Retry on transient errors
Distinguish 5xx, network errors, and timeouts from 4xx. Retry transient ones once with backoff. Permanent (404, 403) stay failed and get logged. Likely converts a couple of the current 6 failures into successes.

### Apps Script: shared-secret token
Add a `?token=...` parameter the script validates against a hardcoded secret. URL itself is still secret, so this is defense-in-depth (referer leakage, browser history, server logs). The token rotates without redeploying the URL.

### Backfill / retry mode
A `--retry-errors` flag that reads rows from the sheet where `error` is non-empty, deletes the URL from `seen` for that run, and re-extracts. Useful after fixing a heuristic or when a transient site outage cleared.

## Larger

### Headless-browser fallback for bot-protected sites
The 401/403 floor from DataDome / PerimeterX / Cloudflare bot managers is real and meaningful — Reuters, NYT, WSJ, Bloomberg, Politico, surfertoday, michiganadvance, minnesotareformer, azmirror all blocked our Node fetch. Plain `fetch` can never extract from these even with a perfect User-Agent because the protection inspects TLS fingerprint, JS execution, and behavioral signals. Realistic options:

- **Playwright + stealth plugins**, optionally with residential proxies. Adds ~250 MB of dependency, a Chromium download, and ongoing maintenance as the anti-bot vendors catch up. Belongs in a separate `--scrape-with-browser` mode that's not the default path.
- **`curl-impersonate`** as the HTTP client for these hosts. Lighter than headless Chrome but still significant; doesn't solve JS challenges so won't help with the harder protections.
- **Accept and route to humans**: failed rows already carry the URL and an `error`. A human opens the URL in a real browser, copies the byline, pastes back. Probably the right default for a low-volume tool.

I'd recommend deferring the headless option indefinitely unless the percentage of unscrapable URLs becomes a material gap. The math: a few minutes of human paste-work per week is cheaper than the maintenance cost of an anti-bot arms race.

### Multi-author support
Spec defers to "first author wins". For things like co-bylined news pieces, consider:
- A `coauthors` column (semicolon-separated), OR
- Multiple rows per article (one per author), with `is_primary` flag.

The data model decision drives a lot — whoever's downstream of the sheet (the human doing outreach) has the strongest opinion here.

### Scheduling
Project plan defers cron to "block two". Two real options when ready:
- **launchd plist** (macOS) running `node /path/dist/cli.js run`. Simplest if it's running on this laptop.
- **GitHub Actions** scheduled workflow. Cleaner — no machine dependency, runs even if laptop is shut. Needs `WEBHOOK_URL` as a repo secret. The scope hardening (Apps Script token above) becomes more important when the URL is in CI.

### Automated PII retention
Project plan flags this in "block two" milestones. The actual retention enforcement could live in the Apps Script (run a daily trigger that deletes rows older than N days) — keeps it co-located with the sheet rather than another moving part.

## Low

### Detect non-article pages
Internet Archive book pages and Google Books results landed in the sheet (e.g. "Guisado, Raul, 1971-"). They're real authors of *books*, not articles. Either:
- Per-feed denylist of host patterns (`books.google.com`, `archive.org/details/...`), OR
- Sniff the page type (Book vs Article in JSON-LD) and skip Books.

### Structured run logs
Right now we `console.log(JSON.stringify(summary))` and `console.error` per-feed errors. For a cron-driven setup, write a JSON-line per run to `logs/runs.jsonl` so failures across runs are inspectable. Ties in with retry mode.

### Highlight problem rows in the sheet
The Apps Script could conditional-format rows where `author` is empty AND `error` is empty — those are "extracted nothing, but no error" cases that suggest the heuristics missed. Visual signal that something's worth investigating.

## Won't do (as currently scoped)

- **LLM-based extraction.** Constraint per project plan. Heuristics + library are good enough.
- **Off-page author lookup.** Spec calls this out — author bio pages, social profiles, etc. — as out-of-scope to keep the data minimal (PII concern).
- **HTTP API or web UI.** Tool is a manual-run CLI by design. Adding a server multiplies operational complexity without serving the actual job.

## Cross-cutting

A few of these compound: e.g. **structured run logs + retry mode + GitHub Actions** make the tool durable as an unattended process. Worth thinking about as a single "make this an unattended pipeline" milestone rather than three separate tickets.
