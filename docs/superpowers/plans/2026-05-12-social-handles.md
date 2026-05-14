# Social-Handle Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract social-media URLs from article pages and persist them to four new sheet columns (`bluesky`, `instagram`, `linkedin`, `twitter`) — pulled from JSON-LD `sameAs` and byline-area anchors, filtered through a host allowlist and a share-intent denylist, mixed across all authors and the publisher.

**Architecture:** New `src/socials.ts` with two pure functions: `classifySocial(url)` for per-URL host/path classification, and `extractSocials($)` for whole-document extraction (JSON-LD pass + byline-anchor pass). Wire into `src/extract.ts` after existing extractors. Apps Script gets four new columns and a fail-loudly header-integrity check.

**Tech Stack:** TypeScript, Vitest, Node 20+, cheerio. Google Apps Script (`Code.gs`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-social-handles-design.md`
**Research:** `notes/social-handles-research.md`

---

## File map

- **Create:** `src/socials.ts` — `classifySocial`, `extractSocials`, `extractSocialsFromHtml`, `SocialColumn`, `SocialResult`
- **Create:** `test/socials.test.ts` — unit + integration tests
- **Create:** `test/fixtures/article-socials-jsonld.html`
- **Create:** `test/fixtures/article-socials-byline-anchors.html`
- **Create:** `test/fixtures/article-socials-mixed.html`
- **Create:** `test/fixtures/article-socials-none.html`
- **Modify:** `src/types.ts` — add `socials?: SocialResult` to `ExtractionResult`
- **Modify:** `src/extract.ts` — call `extractSocials($)` after existing extractors
- **Modify:** `apps-script/Code.gs` — `COLUMNS` array, `ensureSheet_` header gate, `rowToValues_` join
- **Modify:** `README.md` — sheet-migration note for existing deployments

---

## Task 1: `classifySocial` helper + unit tests (TDD)

**Files:**
- Create: `src/socials.ts`
- Create: `test/socials.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/socials.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifySocial } from "../src/socials.js";

describe("classifySocial — twitter / x", () => {
  it("classifies twitter.com profile URL as twitter", () => {
    expect(classifySocial("https://twitter.com/mrbrownsir")).toEqual({
      column: "twitter",
      url: "https://twitter.com/mrbrownsir",
    });
  });

  it("classifies x.com profile URL as twitter", () => {
    expect(classifySocial("https://x.com/maggie_dough")).toEqual({
      column: "twitter",
      url: "https://x.com/maggie_dough",
    });
  });

  it("strips leading www. from host but preserves it in the stored URL", () => {
    expect(classifySocial("https://www.x.com/foo")).toEqual({
      column: "twitter",
      url: "https://www.x.com/foo",
    });
  });

  it("rejects twitter share intents", () => {
    expect(classifySocial("https://twitter.com/intent/tweet?url=...")).toBeNull();
  });

  it("rejects /share path", () => {
    expect(classifySocial("https://twitter.com/share?u=...")).toBeNull();
  });
});

describe("classifySocial — instagram", () => {
  it("classifies instagram.com profile", () => {
    expect(classifySocial("https://www.instagram.com/byalicefinno/")?.column).toBe("instagram");
  });
});

describe("classifySocial — linkedin", () => {
  it("classifies linkedin.com/in/ profile", () => {
    expect(classifySocial("https://www.linkedin.com/in/sydney-lake/")?.column).toBe("linkedin");
  });

  it("classifies linkedin.com/company/ as linkedin", () => {
    expect(classifySocial("https://www.linkedin.com/company/byline-extraction/")?.column).toBe("linkedin");
  });

  it("rejects linkedin.com/jobs path", () => {
    expect(classifySocial("https://www.linkedin.com/jobs/view/123")).toBeNull();
  });

  it("rejects linkedin shareArticle", () => {
    expect(classifySocial("https://www.linkedin.com/shareArticle?mini=true&url=...")).toBeNull();
  });
});

describe("classifySocial — bluesky", () => {
  it("classifies bsky.app/profile/ as bluesky", () => {
    expect(classifySocial("https://bsky.app/profile/jane.bsky.social")?.column).toBe("bluesky");
  });

  it("rejects bsky.app/intent/compose", () => {
    expect(classifySocial("https://bsky.app/intent/compose?text=...")).toBeNull();
  });
});

describe("classifySocial — negative cases", () => {
  it("rejects facebook (not in allowlist)", () => {
    expect(classifySocial("https://www.facebook.com/something")).toBeNull();
  });

  it("rejects sharer.php", () => {
    expect(classifySocial("https://www.facebook.com/sharer.php?u=...")).toBeNull();
  });

  it("rejects unknown host", () => {
    expect(classifySocial("https://example.com/foo")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(classifySocial("")).toBeNull();
  });

  it("rejects unparseable URL", () => {
    expect(classifySocial("not a url")).toBeNull();
  });

  it("rejects bare hash anchor", () => {
    expect(classifySocial("#")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/socials.test.ts`
Expected: FAIL — `Cannot find module '../src/socials.js'`

- [ ] **Step 3: Implement `classifySocial`**

Create `src/socials.ts`:

```typescript
export type SocialColumn = "bluesky" | "instagram" | "linkedin" | "twitter";

export type SocialResult = Partial<Record<SocialColumn, string[]>>;

const SHARE_INTENT_MARKERS = [
  "/intent/",
  "/share",
  "/sharer.php",
  "intent/tweet",
  "intent/compose",
  "shareArticle",
];

function isShareIntent(url: URL): boolean {
  const pathAndQuery = url.pathname + url.search;
  for (const marker of SHARE_INTENT_MARKERS) {
    if (pathAndQuery.includes(marker)) return true;
  }
  if (url.searchParams.has("share")) return true;
  return false;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function classifySocial(
  rawUrl: string,
): { column: SocialColumn; url: string } | null {
  if (!rawUrl || rawUrl === "#") return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (isShareIntent(url)) return null;
  const host = normalizeHost(url.host);
  const path = url.pathname;
  if (host === "twitter.com" || host === "x.com") {
    return { column: "twitter", url: rawUrl };
  }
  if (host === "instagram.com") {
    return { column: "instagram", url: rawUrl };
  }
  if (host === "linkedin.com") {
    if (path.startsWith("/in/") || path.startsWith("/company/")) {
      return { column: "linkedin", url: rawUrl };
    }
    return null;
  }
  if (host === "bsky.app") {
    if (path.startsWith("/profile/")) {
      return { column: "bluesky", url: rawUrl };
    }
    return null;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/socials.test.ts`
Expected: PASS — all classifier tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/socials.ts test/socials.test.ts
git commit -m "$(cat <<'EOF'
feat(socials): classifySocial helper + tests

Pure-function classifier that maps a raw URL to one of the four social
columns (bluesky, instagram, linkedin, twitter) or null. Applies the
host allowlist, the share-intent denylist, and the linkedin /in/ +
/company/ path restriction.

- src/socials.ts: classifySocial, SocialColumn, SocialResult types
- test/socials.test.ts: 16 unit tests covering positive cases, share intents, wrong paths, and unparseable input

EOF
)"
```

---

## Task 2: JSON-LD `sameAs` extraction (TDD)

**Files:**
- Modify: `src/socials.ts`
- Modify: `test/socials.test.ts`
- Create: `test/fixtures/article-socials-jsonld.html`

- [ ] **Step 1: Create the JSON-LD fixture**

Create `test/fixtures/article-socials-jsonld.html`:

```html
<!DOCTYPE html>
<html><head>
  <title>JSON-LD socials article</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "JSON-LD socials article",
    "author": [
      {
        "@type": "Person",
        "name": "Alice Finno",
        "sameAs": ["https://www.instagram.com/byalicefinno/"]
      },
      {
        "@type": "Person",
        "name": "Bob Author",
        "sameAs": "https://twitter.com/bob"
      }
    ],
    "publisher": {
      "@type": "Organization",
      "name": "Example Newsroom",
      "sameAs": [
        "https://twitter.com/examplenewsroom",
        "https://www.instagram.com/examplenewsroom/",
        "https://www.example.com"
      ]
    }
  }
  </script>
</head><body></body></html>
```

- [ ] **Step 2: Add the failing test**

Append to `test/socials.test.ts`:

```typescript
import { readFileSync } from "fs";
import { join } from "path";
import { extractSocialsFromHtml } from "../src/socials.js";

const fx = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("extractSocialsFromHtml — JSON-LD sameAs", () => {
  it("collects author + publisher sameAs URLs into per-platform columns", () => {
    const result = extractSocialsFromHtml(fx("article-socials-jsonld.html"));
    expect(result.twitter).toEqual(
      expect.arrayContaining([
        "https://twitter.com/bob",
        "https://twitter.com/examplenewsroom",
      ]),
    );
    expect(result.instagram).toEqual(
      expect.arrayContaining([
        "https://www.instagram.com/byalicefinno/",
        "https://www.instagram.com/examplenewsroom/",
      ]),
    );
    // example.com is not on the allowlist
    expect(result.linkedin).toBeUndefined();
    expect(result.bluesky).toBeUndefined();
  });

  it("handles sameAs as a single string (not array)", () => {
    const result = extractSocialsFromHtml(fx("article-socials-jsonld.html"));
    // Bob's sameAs is a bare string; verify it was picked up
    expect(result.twitter).toContain("https://twitter.com/bob");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/socials.test.ts`
Expected: FAIL — `extractSocialsFromHtml is not a function`.

- [ ] **Step 4: Implement the JSON-LD pass**

Append to `src/socials.ts`:

```typescript
import * as cheerio from "cheerio";

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectSameAs(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const same = obj.sameAs;
  if (typeof same === "string") return [same];
  if (Array.isArray(same)) return same.filter((s): s is string => typeof s === "string");
  return [];
}

function jsonLdSocials($: cheerio.CheerioAPI, sink: Map<SocialColumn, Set<string>>): void {
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text();
    if (!text.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const candidates = Array.isArray(data) ? data : [data];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const node = candidate as Record<string, unknown>;
      const authors = asArray(node.author);
      const publishers = asArray(node.publisher);
      const allEntities = [...authors, ...publishers];
      for (const entity of allEntities) {
        for (const url of collectSameAs(entity)) {
          const classified = classifySocial(url);
          if (classified) sink.get(classified.column)!.add(classified.url);
        }
      }
    }
  });
}

function emptySink(): Map<SocialColumn, Set<string>> {
  return new Map<SocialColumn, Set<string>>([
    ["bluesky", new Set()],
    ["instagram", new Set()],
    ["linkedin", new Set()],
    ["twitter", new Set()],
  ]);
}

function sinkToResult(sink: Map<SocialColumn, Set<string>>): SocialResult {
  const out: SocialResult = {};
  for (const [column, urls] of sink) {
    if (urls.size > 0) out[column] = [...urls];
  }
  return out;
}

export function extractSocials($: cheerio.CheerioAPI): SocialResult {
  const sink = emptySink();
  jsonLdSocials($, sink);
  return sinkToResult(sink);
}

export function extractSocialsFromHtml(html: string): SocialResult {
  return extractSocials(cheerio.load(html));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/socials.test.ts`
Expected: PASS — JSON-LD tests pass, classifier tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/socials.ts test/socials.test.ts test/fixtures/article-socials-jsonld.html
git commit -m "$(cat <<'EOF'
feat(socials): extract from JSON-LD Person/Organization sameAs

extractSocialsFromHtml walks every JSON-LD script tag, pulls sameAs
from each author entry (Person, including arrays) and from the
publisher Organization, and classifies each URL through
classifySocial. Per-platform results are deduped via a Set.

- Handles sameAs as a string or as an array of strings
- Drops URLs that fail the allowlist (e.g., the publisher's own
  homepage that some sites include in sameAs)
- New fixture article-socials-jsonld.html exercises the shape

EOF
)"
```

---

## Task 3: Byline-anchor scan (TDD)

**Files:**
- Modify: `src/socials.ts`
- Modify: `test/socials.test.ts`
- Create: `test/fixtures/article-socials-byline-anchors.html`

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/article-socials-byline-anchors.html`:

```html
<!DOCTYPE html>
<html><head><title>Byline-anchor socials</title></head>
<body>
  <article>
    <div class="byline">By <a href="/author/jane">Jane Doe</a></div>
    <div class="Author-socialLinks">
      <a class="SocialLink" rel="noreferrer" href="https://twitter.com/janedoe" target="_blank">twitter</a>
      <a class="SocialLink" rel="noreferrer" href="https://www.instagram.com/janedoe/" target="_blank">instagram</a>
      <a class="SocialLink" rel="noreferrer" href="" target="_blank">empty (drop)</a>
      <a class="SocialLink" rel="noreferrer" href="https://twitter.com/intent/tweet?url=..." target="_blank">share (drop)</a>
    </div>
    <div class="jeg_author_socials">
      <a target="_blank" href="https://example.com" class="url">site (drop)</a>
      <a target="_blank" href="https://www.linkedin.com/in/janedoe/" class="linkedin">linkedin</a>
      <a target="_blank" href="https://bsky.app/profile/janedoe.bsky.social" class="bluesky">bluesky</a>
    </div>
    <p>Story body. Outside the byline area: <a href="https://twitter.com/elsewhere">other</a> should be ignored.</p>
  </article>
</body></html>
```

- [ ] **Step 2: Add the failing test**

Append to `test/socials.test.ts`:

```typescript
describe("extractSocialsFromHtml — byline-area anchor scan", () => {
  it("collects social anchors inside byline regions and drops shares/empties/out-of-area", () => {
    const result = extractSocialsFromHtml(fx("article-socials-byline-anchors.html"));
    expect(result.twitter).toEqual(["https://twitter.com/janedoe"]);
    expect(result.instagram).toEqual(["https://www.instagram.com/janedoe/"]);
    expect(result.linkedin).toEqual(["https://www.linkedin.com/in/janedoe/"]);
    expect(result.bluesky).toEqual(["https://bsky.app/profile/janedoe.bsky.social"]);
  });

  it("does not pick up the in-story twitter.com/elsewhere link", () => {
    const result = extractSocialsFromHtml(fx("article-socials-byline-anchors.html"));
    expect(result.twitter).not.toContain("https://twitter.com/elsewhere");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/socials.test.ts`
Expected: FAIL — anchors in byline regions are not yet scanned.

- [ ] **Step 4: Implement the byline-anchor pass**

Add to `src/socials.ts` (after `jsonLdSocials`, before `extractSocials`):

```typescript
const BYLINE_AREA_SELECTOR = [
  '[rel="author"]',
  '[itemprop="author"]',
  '.byline',
  '.author',
  '.Author-socialLinks',
  '.jeg_author_socials',
  '.author-bio',
  '.mvp-author-info-text',
  '.ArticlePage-authorInfo-bio',
  '[class*="PostByline_author"]',
  'address[class*=author]',
].join(", ");

function bylineAnchorSocials(
  $: cheerio.CheerioAPI,
  sink: Map<SocialColumn, Set<string>>,
): void {
  $(BYLINE_AREA_SELECTOR).each((_, area) => {
    $(area)
      .find("a[href]")
      .each((_, a) => {
        const href = $(a).attr("href");
        if (!href) return;
        const classified = classifySocial(href);
        if (classified) sink.get(classified.column)!.add(classified.url);
      });
  });
}
```

Update `extractSocials` to invoke it:

```typescript
export function extractSocials($: cheerio.CheerioAPI): SocialResult {
  const sink = emptySink();
  jsonLdSocials($, sink);
  bylineAnchorSocials($, sink);
  return sinkToResult(sink);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/socials.test.ts`
Expected: PASS — all byline-anchor tests pass plus prior tests.

- [ ] **Step 6: Commit**

```bash
git add src/socials.ts test/socials.test.ts test/fixtures/article-socials-byline-anchors.html
git commit -m "$(cat <<'EOF'
feat(socials): byline-area anchor scan

Adds a second extraction pass that scans <a href> anchors inside known
byline / author-bio regions (AP, Jegtheme, Newspack, Capital & Main,
LAist, LA Taco). Each href runs through classifySocial; results merge
into the same per-platform sets as the JSON-LD pass and are deduped.

The selector list intentionally includes some broad matches
(.byline, .author) so author-name regions also get scanned for
incidental social links. Anchors elsewhere in the article body are
ignored.

EOF
)"
```

---

## Task 4: Mixed-source integration test + negative case

**Files:**
- Modify: `test/socials.test.ts`
- Create: `test/fixtures/article-socials-mixed.html`
- Create: `test/fixtures/article-socials-none.html`

- [ ] **Step 1: Create the mixed-source fixture**

Create `test/fixtures/article-socials-mixed.html` (JSON-LD sameAs AND byline anchors with overlap to verify dedup):

```html
<!DOCTYPE html>
<html><head>
  <title>Mixed sources</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "author": { "@type": "Person", "name": "Sam", "sameAs": ["https://twitter.com/sam"] },
    "publisher": { "@type": "Organization", "name": "Pub", "sameAs": ["https://twitter.com/pub"] }
  }
  </script>
</head>
<body>
  <div class="author-bio">
    <a href="https://twitter.com/sam">Sam on Twitter</a>
    <a href="https://www.linkedin.com/in/sam/">Sam on LinkedIn</a>
  </div>
</body></html>
```

- [ ] **Step 2: Create the negative fixture**

Create `test/fixtures/article-socials-none.html` (only share intents and footer publisher links — should yield empty result):

```html
<!DOCTYPE html>
<html><head><title>No socials</title></head>
<body>
  <article>
    <div class="byline">By <a href="/author/jane">Jane Doe</a></div>
    <div class="share-buttons">
      <a href="https://twitter.com/intent/tweet?url=...">Tweet</a>
      <a href="https://www.facebook.com/sharer.php?u=...">Share on FB</a>
      <a href="">empty</a>
    </div>
    <p>Body content. Out-of-area: <a href="https://twitter.com/somethingelse">x</a></p>
  </article>
  <footer>
    <a href="https://www.linkedin.com/shareArticle?mini=true&url=...">linkedin share</a>
  </footer>
</body></html>
```

- [ ] **Step 3: Add the failing tests**

Append to `test/socials.test.ts`:

```typescript
describe("extractSocialsFromHtml — combined sources", () => {
  it("dedupes URLs that appear in both JSON-LD and byline anchors", () => {
    const result = extractSocialsFromHtml(fx("article-socials-mixed.html"));
    // twitter.com/sam appears in sameAs AND in the byline anchor → exactly once
    expect(result.twitter?.filter((u) => u === "https://twitter.com/sam")).toHaveLength(1);
    // Both author and publisher twitter URLs land in the same column
    expect(result.twitter).toEqual(
      expect.arrayContaining(["https://twitter.com/sam", "https://twitter.com/pub"]),
    );
    expect(result.linkedin).toEqual(["https://www.linkedin.com/in/sam/"]);
  });

  it("returns an empty result when only share intents and out-of-area links exist", () => {
    const result = extractSocialsFromHtml(fx("article-socials-none.html"));
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/socials.test.ts`
Expected: PASS — both new tests pass on the existing implementation (dedup is already enforced by the per-column Set, and the negative case has nothing on the allowlist inside byline regions).

If the negative case fails because `<a href="">` inside `.byline` returns truthy from `$(a).attr("href")`: confirm `if (!href) return;` is in `bylineAnchorSocials` — empty string is falsy and is skipped. The test should pass; if it doesn't, the bug is in `bylineAnchorSocials`, fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add test/socials.test.ts test/fixtures/article-socials-mixed.html test/fixtures/article-socials-none.html
git commit -m "$(cat <<'EOF'
test(socials): combined-source + negative fixtures

Confirms that a URL appearing in both JSON-LD sameAs and a byline
anchor lands in the column exactly once, and that a page with only
share intents and out-of-area links returns an empty result.

EOF
)"
```

---

## Task 5: Wire into `extract.ts` + extend `ExtractionResult`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/extract.ts`
- Modify: `test/extract.test.ts`

- [ ] **Step 1: Extend `ExtractionResult` in `src/types.ts`**

```typescript
import type { SocialResult } from "./socials.js";

export type ExtractionResult = {
  sourceUrl: string;
  author: string;
  authorEmail?: string;
  pageUrl: string;
  feedTitle?: string;
  title?: string;
  publishedAt?: string;
  error?: string;
  socials?: SocialResult;
};
```

(Re-export `SocialResult` and `SocialColumn` here if you prefer a single types-import path, but a direct import in consumers is fine.)

- [ ] **Step 2: Wire `extractSocials` into `extract.ts`**

In `src/extract.ts`, add to the imports:

```typescript
import { extractSocials } from "./socials.js";
```

Update `extractAuthorFromHtml` to attach socials before returning:

```typescript
export function extractAuthorFromHtml(
  html: string,
  sourceUrl: string,
): PartialResult {
  const $ = cheerio.load(html);
  const result: PartialResult = { sourceUrl, author: "" };

  // ... existing extractor calls unchanged ...

  if (result.author) result.author = collapseWhitespace(result.author);

  const socials = extractSocials($);
  if (Object.keys(socials).length > 0) result.socials = socials;

  return result;
}
```

The "only attach if non-empty" check keeps the field absent on rows with no socials, mirroring how `authorEmail` is handled today.

- [ ] **Step 3: Add a test that the socials field propagates**

Append to `test/extract.test.ts` (next to the JSON-LD tests):

```typescript
describe("extractAuthorFromHtml — socials propagation", () => {
  it("attaches a socials field when the article has author sameAs", () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "author": { "@type": "Person", "name": "Ada", "sameAs": ["https://twitter.com/ada"] }
      }</script>
    </head><body></body></html>`;
    const r = extractAuthorFromHtml(html, "https://example.com/a");
    expect(r.author).toBe("Ada");
    expect(r.socials).toEqual({ twitter: ["https://twitter.com/ada"] });
  });

  it("omits the socials field when no socials are found", () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "author": { "@type": "Person", "name": "Ada" }
      }</script>
    </head><body></body></html>`;
    const r = extractAuthorFromHtml(html, "https://example.com/a");
    expect(r.socials).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS. New extract tests pass; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/extract.ts test/extract.test.ts
git commit -m "$(cat <<'EOF'
feat(extract): attach socials to ExtractionResult

extractAuthorFromHtml now calls extractSocials($) after the existing
author/email/title/publishedAt passes. The socials field is attached
only when non-empty, mirroring how authorEmail is handled.

- src/types.ts: socials?: SocialResult on ExtractionResult
- src/extract.ts: one-line wire-in after author extraction
- test/extract.test.ts: two tests confirming the field propagates and is omitted when empty

EOF
)"
```

---

## Task 6: Apps Script — columns, header gate, rowToValues_

**Files:**
- Modify: `apps-script/Code.gs`

- [ ] **Step 1: Update the `COLUMNS` array**

Replace the existing `COLUMNS` constant in `apps-script/Code.gs` with:

```javascript
const COLUMNS = [
  "feed_title",
  "author",
  "author_email",
  "bluesky",
  "instagram",
  "linkedin",
  "twitter",
  "source_url",
  "page_url",
  "title",
  "published_at",
  "extracted_at",
  "error",
];
```

- [ ] **Step 2: Add the header-integrity check in `ensureSheet_`**

Replace `ensureSheet_` with:

```javascript
function ensureSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    return sheet;
  }
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

The existing `try/catch` in `doGet`/`doPost` wraps thrown errors into `{ error: "..." }` JSON. The CLI's `parse` helper in `src/sheet.ts` surfaces that as `webhook seen failed: <error>` / `webhook append failed: <error>`, which is the "fail loudly" path.

- [ ] **Step 3: Update `rowToValues_` to populate the four new columns**

Replace `rowToValues_` with:

```javascript
function rowToValues_(row) {
  // extracted_at as calendar date only (YYYY-MM-DD, UTC) so the column is
  // clusterable by day in the sheet without per-cell timestamp noise.
  const extractedAt = new Date().toISOString().slice(0, 10);
  const socials = row.socials || {};
  const join = function (arr) { return (arr || []).join("; "); };
  return [
    row.feedTitle || "",
    row.author || "",
    row.authorEmail || "",
    join(socials.bluesky),
    join(socials.instagram),
    join(socials.linkedin),
    join(socials.twitter),
    row.sourceUrl || "",
    row.pageUrl || "",
    row.title || "",
    row.publishedAt || "",
    extractedAt,
    row.error || "",
  ];
}
```

`readSeenUrls_` and `upsertRows_` already locate columns via `COLUMNS.indexOf(...)`, so they self-adjust to the new positions — no edits needed there.

- [ ] **Step 4: Verify the file builds (no JS syntax errors)**

Apps Script doesn't have a local linter via npm, but we can sanity-check the file is parseable by running it through Node:

```bash
node --check apps-script/Code.gs
```

Expected: no output (parseable). If a syntax error is reported, fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add apps-script/Code.gs
git commit -m "$(cat <<'EOF'
feat(apps-script): four social columns + fail-loud header gate

Adds bluesky/instagram/linkedin/twitter columns to the SOURCE sheet
schema and a header-integrity check in ensureSheet_ that throws on
any mismatch with the expected COLUMNS. The error surfaces as a
webhook error in the CLI and aborts the run; sheets that haven't been
migrated must add the four new columns to the header row.

- COLUMNS extended to 13 entries; socials inserted alphabetically after author_email
- ensureSheet_ throws "Sheet header mismatch at column N..." on any drift, with the expected and found values
- rowToValues_ joins each socials.<platform> array with "; " and writes empty string when the field is absent
- readSeenUrls_ and upsertRows_ use COLUMNS.indexOf and self-adjust

EOF
)"
```

---

## Task 7: README — sheet migration note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the migration section**

In `README.md`, find the "Sheet schema" section (around line 75) and replace the schema table + paragraph with:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): document four social columns + sheet migration

Updates the schema table to the new 13-column layout and adds a
migration section explaining the manual steps required for sheets
created before May 2026.

EOF
)"
```

---

## Task 8: Integration verification

**Files:** None (verification only)

- [ ] **Step 1: Type-check the project**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: All tests pass. The `socials.test.ts` adds ~22 tests; `extract.test.ts` adds 2.

- [ ] **Step 3: Build the dist**

Run: `npm run build`
Expected: No type errors. `dist/socials.js` exists alongside the updated `dist/extract.js` and `dist/types.js`.

- [ ] **Step 4: Optional smoke check (dry-run)**

If a network is available, run the CLI in dry-run mode to confirm socials show up on some live extractions:

```bash
npx tsx src/cli.ts run --dry-run 2>&1 | head -80
```

The dry-run sheet client doesn't print row content, so this only verifies the run completes without errors. To see actual socials, point the sheet client at a non-prod webhook or temporarily log appended rows in `run.ts`. Not blocking.

- [ ] **Step 5: Final commit if anything was tidied up**

If no further changes were needed, no commit. Otherwise commit with a `chore:` prefix.

---

## Spec coverage check

| Spec section | Implemented by |
|---|---|
| Schema: 4 columns after `author_email` | Task 6 (COLUMNS array, rowToValues_) + Task 7 (README) |
| `; `-joined URLs per column | Task 6 (`join(...)`) |
| Platform allowlist (twitter/x, instagram, linkedin/in/+company, bsky/profile) | Task 1 (`classifySocial`) |
| Share-intent denylist | Task 1 (`SHARE_INTENT_MARKERS`, `?share=`, empty href) |
| `www.` host stripping for matching | Task 1 (`normalizeHost`) |
| Empty `href` drop | Task 1 (`if (!rawUrl)`) + Task 3 (anchor scan skip) |
| JSON-LD `sameAs` from authors and publisher | Task 2 (`jsonLdSocials`, walks both) |
| Byline-area anchor scan | Task 3 (`bylineAnchorSocials`, full selector list) |
| Per-platform `Set<string>` dedup | Task 2 (`emptySink`) + Task 4 (dedup test) |
| `ExtractionResult.socials?: SocialResult` | Task 5 |
| `extract.ts` calls `extractSocials($)` | Task 5 |
| `Code.gs` `COLUMNS`, `ensureSheet_` gate, `rowToValues_` join | Task 6 |
| Manual migration documented | Task 7 |
| LinkedIn restricted to `/in/` and `/company/` | Task 1 (path startsWith) |
| Bluesky restricted to `/profile/` | Task 1 (path startsWith) |
| Acceptance: typecheck + tests + build clean | Task 8 |
