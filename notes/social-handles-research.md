# Social-handle extraction — research notes

Date: 2026-05-12
Branch: `feat/social-handles`
Purpose: Decide whether news article pages reliably expose author social handles, and if so, what selectors could grab them. Bounded to whatever the article page itself shows — no off-page author lookup.

## Method

- Pulled a sample of article URLs from the `unbreaking.org` `/issues/immigration/` and `/issues/medicaid/` pages.
- Curled 13 articles with the project's polite User-Agent. Three returned 403 (`19thnews`, `georgiarecorder`, `coloradonewsline`, `documentedny` — bot-blocked even with a polite UA, consistent with `enhancement-ideas.md`).
- 13 successful fetches across wire, nonprofit, magazine, indie investigative, local-indie, and community-paper categories.
- For each: scanned for social URLs (twitter/x/bsky/linkedin/threads/instagram), inspected byline/author-bio markup, inspected JSON-LD Person entities for `sameAs`.

Platforms in scope: Twitter/X (`twitter.com`, `x.com`), Bluesky (`bsky.app`), LinkedIn (`linkedin.com/in/`), Mastodon (any host, identified by `rel=me` or `@user@host`), Threads (`threads.net`), Instagram (`instagram.com`).

## Per-site findings

Legend: ✅ author social present and machine-readable · 🟡 present but harder (plain text / aria-label discrimination needed) · ❌ none on this page.

| # | Site | Author | Author socials on this page | Where in the markup |
|---|---|---|---|---|
| 1 | AP News | Matt Brown (et al.) | ✅ `twitter.com/mrbrownsir`, `instagram.com/mrbrownsir/` | `.Author-socialLinks > a.SocialLink[data-social-service="twitter"\|"instagram"\|...]` |
| 2 | Mission Local | Alice Finno | ✅ `instagram.com/byalicefinno/` | JSON-LD Person `sameAs` |
| 3 | Block Club Chicago | Melody Mercado | 🟡 `@melodymercadotv` (Twitter) as **plain text** in author-bio paragraph; not linked, not in JSON-LD | `.author-bio-text p` — text only |
| 4 | El Paso Matters | Robert Moore | ❌ JSON-LD `sameAs` lists only `http://elpasomatters.org` (publisher domain) |  — |
| 5 | Capitol News Illinois | Maggie Dougherty | ✅ `x.com/maggie_dough`, `linkedin.com/in/doughertymaggie/`, `instagram.com/maggie_dough` | `.jeg_author_socials > a.twitter \| .linkedin \| .instagram` (Jegtheme) **and** JSON-LD `sameAs` (but with a CMS bug — see below) |
| 6 | Capital & Main | Kate Morrissey | ❌ `.mvp-author-info-twit-but` exists but `href=""` — empty placeholder |  — |
| 7 | Bolts | Pascal Sabino | ❌ Byline links to internal `/authors/<slug>/` page only |  — |
| 8 | Amsterdam News | Karen Juanita Carrillo | ❌ Byline links to internal `/author/<slug>/` page only; `share-twitter` is a share button |  — |
| 9 | KFF Health News | Samantha Liss, Sam Whitehead | ❌ (email only — `.article-author-contact__email` `mailto:`) | mailto already covered by existing email extractor |
| 10 | Fortune | Sydney Lake | ✅ `twitter.com/syddlake`, `linkedin.com/in/sydney-lake/` | `a[aria-label*="Author Name"][data-cy="twitter-icon"\|"linkedin-icon"]` — `aria-label` includes the author's name, which discriminates from publisher footer accounts |
| 11 | LAist | Jordan Rynning | ❌ Byline links to internal `/people/<slug>` page only |  — |
| 12 | LA Taco | Izzy Ramirez | ❌ Byline links to internal `/author/<slug>` page only |  — |
| 13 | Bitter Southerner | (no Person in JSON-LD) | ❌ Squarespace-based; minimal byline structure |  — |

## Hit rate

- ✅ Machine-readable author socials on the article page: **4 of 13** (AP, Mission Local, Capitol News Illinois, Fortune) ≈ **31%**.
- 🟡 Plain-text only: **1 of 13** (Block Club Chicago).
- ❌ None on the article page: **8 of 13**.

Across the eight "none" sites, all of them link the author byline to an internal staff page (`/author/<slug>`, `/authors/<slug>`, `/people/<slug>`). Those staff pages may carry social handles — but the user has explicitly scoped this to the article page itself, so we don't follow them.

## Patterns worth implementing

In rough order of yield / effort:

### 1. JSON-LD `Person.sameAs` (universal-ish, filtered)

```ts
// inside tryJsonLd's per-author loop
for (const author of authorList) {
  const same = author.sameAs;
  const candidates = Array.isArray(same) ? same : (typeof same === 'string' ? [same] : []);
  for (const url of candidates) {
    if (!isString(url)) continue;
    const host = safeHost(url);
    if (!SOCIAL_HOSTS.has(host)) continue;  // drops publisher URLs (El Paso Matters)
    // ... record by platform
  }
}
```

`SOCIAL_HOSTS` allowlist drops the El Paso Matters / Capitol News Illinois publisher-URL noise. Also gives us tolerance for the Capitol News Illinois CMS bug (`https://x.com/https://x.com/maggie_dough` — host extraction nullifies the doubled path).

Hits in this sample: Mission Local, Capitol News Illinois (with cleanup).

### 2. Generic byline-area anchor scan

Look inside the author/byline region for `<a href>` matching a social-host pattern, **excluding** known share/intent paths (`/intent/`, `/share`, `/sharer.php`, `?share=`, `intent/tweet`, `intent/compose`, `shareArticle`).

Pseudocode:
```ts
const BYLINE_AREAS = [
  '.Author-socialLinks',          // AP
  '.jeg_author_socials',          // Jegtheme (Capitol News IL)
  '.author-bio',                  // Newspack (Mission Local, Block Club, El Paso Matters)
  '.mvp-author-info-text',        // Capital & Main (theme)
  '.ArticlePage-authorInfo-bio',  // LAist
  '.PostByline_author',           // LA Taco (CSS modules — prefix match)
  'address[class*=author]',
];
for (const area of $(BYLINE_AREAS.join(', '))) {
  for (const a of $(area).find('a[href]')) {
    const url = $(a).attr('href');
    if (!url) continue;
    const host = safeHost(url);
    if (!SOCIAL_HOSTS.has(host)) continue;
    if (isShareIntent(url)) continue;            // intent/, share, sharer.php
    if (href === '') continue;                   // Capital & Main empty placeholder
    // Record
  }
}
```

Hits in this sample: AP, Capitol News Illinois.

### 3. `aria-label` discrimination (Fortune)

```ts
// Fortune embeds: aria-label="Go to Sydney Lake's Twitter profile" href="https://twitter.com/syddlake"
$('a[aria-label]').each((_, a) => {
  const label = $(a).attr('aria-label') ?? '';
  const href = $(a).attr('href') ?? '';
  const host = safeHost(href);
  if (!SOCIAL_HOSTS.has(host)) return;
  if (isShareIntent(href)) return;
  if (authorNames.some(name => label.includes(name))) {
    // Record
  }
});
```

Requires that we've already extracted the author name(s). Hits: Fortune. Probably also catches a few other React/Next.js-based publishers using similar accessibility patterns — diminishing returns though.

### 4. Plain-text "Twitter @handle" pattern (Block Club Chicago)

Lowest yield, ugliest regex, highest false-positive risk. The author wrote `"Twitter @melodymercadotv"` as bio prose. Recoverable but I'd recommend skipping until we have data showing it's a meaningful chunk of misses. Skipping aligns with the "no placeholders" principle — better to leave the column empty than to populate it from prose patterns we can't validate.

If we did want to do it later:
```
/(Twitter|X|Bluesky|Mastodon|Threads|Instagram|LinkedIn)\s*[:|]?\s*@([\w.-]+)/i
```
And only within the resolved author-bio region. False positives: any mention of a Twitter/X handle in a quoted source ("said @senatorJones in a tweet").

## Filtering rules (apply to every source above)

Drop the URL if any of:
- Host is not in the `SOCIAL_HOSTS` allowlist.
- Path is a share intent: `/intent/`, `/share`, `/sharer.php`, `?share=`, contains `intent/tweet`, `intent/compose`, `shareArticle`.
- `href` is empty or `#` (Capital & Main placeholder).
- The handle in the URL path matches the publisher's known handle on that host (would need a publisher-handle allowlist per site, or just live with "publisher socials sometimes appear in author bios" as low-grade noise).

Normalize before persisting:
- Strip query strings and trailing slashes.
- Lowercase the host.
- Collapse `twitter.com` and `x.com` for the same handle into one canonical (preserve original URL but flag platform as `x`).

## Schema implications (deferred — separate brainstorming step)

The user wants this enhancement to ship as a schema change to the sheet. Options to consider when we move from research → design:

- One `socials` column with all URLs joined by `; ` (simplest, matches existing multi-author pattern).
- Per-platform columns (`twitter`, `bluesky`, `linkedin`, `instagram`, `threads`, `mastodon`) — wider sheet, easier filtering.
- One `socials_json` column with a structured JSON blob (`{"twitter": "...", "bluesky": "..."}`) — flexible but ugly in the sheet UI.

Hit rate from this sample (4/13) means most rows will have an empty value regardless of schema choice.

## Recommendation

Implement JSON-LD `sameAs` (#1) + byline-area anchor scan (#2) as the v1. They cover 3 of the 4 ✅ sites and are easy to test with fixtures from these 13 pages. Defer aria-label discrimination (#3) and plain-text parsing (#4) until we see actual data showing they'd move the needle.

Expected v1 yield from this sample: 3 of 13 (~23%) — Mission Local, Capitol News Illinois, AP. Fortune (Sydney Lake) would also hit if we add #3.

## Open questions for design

1. Schema shape (one column vs many vs JSON blob).
2. Multi-author articles (AP has 3) — list all authors' socials, or only first author's?
3. What does the user emailing the author actually do with a Bluesky handle vs an X handle vs a LinkedIn URL? That answer drives whether per-platform columns earn their cost.
4. Mastodon — none seen in this sample. Worth supporting now or wait?

## Raw data

Fetched HTML files retained at `/tmp/social-research/*.html` for the duration of this terminal session. Not committed to the repo.
