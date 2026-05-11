# Byline Extraction Implementation Plan

> **Status: Archival.** This plan drove the initial v1 implementation on 2026-05-09. Many subsequent changes (Apps Script webhook pivot, token auth, `--retry-errors`, `feed_title` column, multi-author handling, GitHub Actions workflow, polite User-Agent, etc.) are not reflected here. See `README.md` and the current source for ground truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node/TypeScript CLI (`byline run`) that scrapes configured Organization pages for outbound article links, extracts author and email from each new article using HTML heuristics, and appends rows to a Google Sheet.

**Architecture:** Single TypeScript package. Pure-function core (`extractLinksFromHtml`, `extractAuthorFromHtml`) wrapped by thin fetch + I/O orchestration. Google Sheet is the only persisted state; the `source_url` column is the dedup key. Errors during article extraction are recorded as rows with `error` populated, never halt the run.

**Tech Stack:** Node 20+, TypeScript 5, `cheerio` (DOM parsing), `googleapis` (Sheets v4), `dotenv` (env), `commander` (CLI argv), `vitest` (tests). Built-in `fetch` for HTTP.

**Spec:** `docs/superpowers/specs/2026-05-09-byline-extraction-design.md`

---

## File Structure

```
src/
  types.ts          # ExtractionResult, FeedConfig, AppConfig
  config.ts         # loadConfig() — reads + validates config.json
  feeds.ts          # extractLinksFromHtml() pure; findLinks() fetches + parses
  extract.ts        # extractAuthorFromHtml() pure; extractAuthor() fetches + parses
  sheet.ts          # readSeenSourceUrls(), appendRows() — googleapis wrappers
  run.ts            # orchestrator
  cli.ts            # commander entry, calls run()
test/
  fixtures/
    feed-with-selector.html
    feed-with-pattern.html
    article-jsonld.html
    article-meta.html
    article-css-byline.html
    article-no-author.html
    article-with-mailto.html
    article-with-generic-mailbox.html
  config.test.ts
  feeds.test.ts
  extract.test.ts
config.json         # committed; example feed
.env.example        # committed; documents required env vars
package.json
tsconfig.json
vitest.config.ts
README.md
```

Each `src/*.ts` has one responsibility. Pure parsers in `feeds.ts` and `extract.ts` are tested directly against fixture HTML — no fetch mocking needed.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`

- [ ] **Step 1: Initialize package.json**

Create `package.json`:

```json
{
  "name": "byline-extraction",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "byline": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node --loader tsx ./src/cli.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cheerio": "^1.0.0",
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "googleapis": "^144.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create .env.example**

```
# Google Sheet target
GOOGLE_SHEET_ID=
GOOGLE_SHEET_TAB=Sheet1

# Path to a service-account JSON key. The SA email must be shared into the target sheet with edit permission.
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: clean install, no peer-dep errors. Creates `node_modules/` and `package-lock.json`.

- [ ] **Step 6: Verify typecheck on empty project**

Create empty `src/index.ts` with `export {};` so tsc has something to compile.
Run: `npm run typecheck`
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/index.ts
git commit -m "chore: scaffold Node/TS project with vitest"
```

---

## Task 2: Type definitions

**Files:**
- Create: `src/types.ts`
- Delete: `src/index.ts` (placeholder from Task 1)

- [ ] **Step 1: Create src/types.ts**

```ts
export type ExtractionResult = {
  sourceUrl: string;
  author: string;
  authorEmail?: string;
  pageUrl: string;
  title?: string;
  publishedAt?: string;
  error?: string;
};

export type FeedConfig = {
  pageUrl: string;
  linkSelector?: string;
  linkPattern?: string;
};

export type AppConfig = {
  feeds: FeedConfig[];
};
```

- [ ] **Step 2: Remove placeholder index.ts**

```bash
rm src/index.ts
```

- [ ] **Step 3: Update tsconfig include if needed**

`tsconfig.json` already includes `src/**/*`, no change needed. Run `npm run typecheck` — expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add core types"
```

---

## Task 3: Config loader (TDD)

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../src/config.js";

function withTempConfig(contents: string, fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "byline-"));
  const path = join(dir, "config.json");
  writeFileSync(path, contents);
  try { fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("loadConfig", () => {
  it("loads a valid config", () => {
    withTempConfig(JSON.stringify({
      feeds: [{ pageUrl: "https://example.com", linkSelector: "a.x" }],
    }), (p) => {
      const cfg = loadConfig(p);
      expect(cfg.feeds).toHaveLength(1);
      expect(cfg.feeds[0].pageUrl).toBe("https://example.com");
    });
  });

  it("rejects feed missing pageUrl", () => {
    withTempConfig(JSON.stringify({ feeds: [{}] }), (p) => {
      expect(() => loadConfig(p)).toThrow(/pageUrl/);
    });
  });

  it("rejects feed missing both linkSelector and linkPattern", () => {
    withTempConfig(JSON.stringify({
      feeds: [{ pageUrl: "https://example.com" }],
    }), (p) => {
      expect(() => loadConfig(p)).toThrow(/linkSelector or linkPattern/);
    });
  });

  it("rejects empty feeds array", () => {
    withTempConfig(JSON.stringify({ feeds: [] }), (p) => {
      expect(() => loadConfig(p)).toThrow(/at least one feed/);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: 4 tests fail with "Cannot find module '../src/config.js'" or similar.

- [ ] **Step 3: Implement src/config.ts**

```ts
import { readFileSync } from "fs";
import type { AppConfig } from "./types.js";

export function loadConfig(path: string): AppConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw.feeds || !Array.isArray(raw.feeds) || raw.feeds.length === 0) {
    throw new Error("config: at least one feed is required");
  }
  for (const [i, feed] of raw.feeds.entries()) {
    if (!feed.pageUrl || typeof feed.pageUrl !== "string") {
      throw new Error(`config: feeds[${i}].pageUrl is required`);
    }
    if (!feed.linkSelector && !feed.linkPattern) {
      throw new Error(`config: feeds[${i}] needs linkSelector or linkPattern`);
    }
  }
  return raw as AppConfig;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): load and validate config.json"
```

---

## Task 4: Feeds — pure HTML parser (TDD)

**Files:**
- Create: `src/feeds.ts`, `test/fixtures/feed-with-selector.html`, `test/fixtures/feed-with-pattern.html`, `test/feeds.test.ts`

- [ ] **Step 1: Create fixture: feed-with-selector.html**

```html
<!DOCTYPE html>
<html><body>
  <a class="article-link" href="/articles/1">First</a>
  <a class="article-link" href="https://other.com/articles/2">Second</a>
  <a class="nav-link" href="/about">About</a>
</body></html>
```

- [ ] **Step 2: Create fixture: feed-with-pattern.html**

```html
<!DOCTYPE html>
<html><body>
  <a href="https://news.example.com/2026/05/01/story-a">A</a>
  <a href="https://news.example.com/2026/05/02/story-b">B</a>
  <a href="https://other.com/about">Other</a>
  <a href="/admin">Admin</a>
</body></html>
```

- [ ] **Step 3: Write failing tests**

Create `test/feeds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractLinksFromHtml } from "../src/feeds.js";

const fx = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("extractLinksFromHtml", () => {
  it("returns absolute URLs matching linkSelector", () => {
    const links = extractLinksFromHtml(
      fx("feed-with-selector.html"),
      "https://example.com/news",
      { pageUrl: "https://example.com/news", linkSelector: "a.article-link" },
    );
    expect(links).toEqual([
      "https://example.com/articles/1",
      "https://other.com/articles/2",
    ]);
  });

  it("filters by linkPattern when no selector given", () => {
    const links = extractLinksFromHtml(
      fx("feed-with-pattern.html"),
      "https://example.com/news",
      {
        pageUrl: "https://example.com/news",
        linkPattern: "^https://news\\.example\\.com/\\d{4}/",
      },
    );
    expect(links).toEqual([
      "https://news.example.com/2026/05/01/story-a",
      "https://news.example.com/2026/05/02/story-b",
    ]);
  });

  it("dedupes repeated URLs", () => {
    const html = `<a class="x" href="/a">1</a><a class="x" href="/a">2</a>`;
    const links = extractLinksFromHtml(html, "https://example.com", {
      pageUrl: "https://example.com",
      linkSelector: "a.x",
    });
    expect(links).toEqual(["https://example.com/a"]);
  });
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `npm test`
Expected: 3 tests fail (module not found).

- [ ] **Step 5: Implement src/feeds.ts (pure parser)**

```ts
import * as cheerio from "cheerio";
import type { FeedConfig } from "./types.js";

export function extractLinksFromHtml(
  html: string,
  baseUrl: string,
  feed: FeedConfig,
): string[] {
  const $ = cheerio.load(html);
  const selector = feed.linkSelector ?? "a[href]";
  const pattern = feed.linkPattern ? new RegExp(feed.linkPattern) : null;
  const out = new Set<string>();
  $(selector).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (pattern && !pattern.test(abs)) return;
    out.add(abs);
  });
  return [...out];
}
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `npm test`
Expected: 7 tests pass (4 config + 3 feeds).

- [ ] **Step 7: Commit**

```bash
git add src/feeds.ts test/feeds.test.ts test/fixtures/feed-with-*.html
git commit -m "feat(feeds): pure HTML link extractor"
```

---

## Task 5: Feeds — fetch wrapper

**Files:**
- Modify: `src/feeds.ts`

- [ ] **Step 1: Add findLinks to src/feeds.ts**

Append to `src/feeds.ts`:

```ts
export async function findLinks(
  feed: FeedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(feed.pageUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${feed.pageUrl} failed: ${res.status}`);
  }
  const html = await res.text();
  return extractLinksFromHtml(html, feed.pageUrl, feed);
}
```

- [ ] **Step 2: Add a test that injects a fake fetch**

Append to `test/feeds.test.ts`:

```ts
import { findLinks } from "../src/feeds.js";

describe("findLinks", () => {
  it("uses injected fetch and parses returned HTML", async () => {
    const fakeFetch = async () =>
      new Response(`<a class="x" href="/a">A</a>`, { status: 200 });
    const links = await findLinks(
      { pageUrl: "https://example.com", linkSelector: "a.x" },
      fakeFetch as typeof fetch,
    );
    expect(links).toEqual(["https://example.com/a"]);
  });

  it("throws on non-2xx", async () => {
    const fakeFetch = async () => new Response("nope", { status: 500 });
    await expect(
      findLinks(
        { pageUrl: "https://example.com", linkSelector: "a" },
        fakeFetch as typeof fetch,
      ),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/feeds.ts test/feeds.test.ts
git commit -m "feat(feeds): add fetch wrapper with timeout"
```

---

## Task 6: Extract — JSON-LD heuristic (TDD)

**Files:**
- Create: `src/extract.ts`, `test/fixtures/article-jsonld.html`, `test/extract.test.ts`

- [ ] **Step 1: Create fixture article-jsonld.html**

```html
<!DOCTYPE html>
<html><head>
  <title>JSON-LD Article</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "JSON-LD Article",
    "author": { "@type": "Person", "name": "Ada Lovelace", "email": "ada@example.com" },
    "datePublished": "2026-04-01T10:00:00Z"
  }
  </script>
</head><body><h1>Hello</h1></body></html>
```

- [ ] **Step 2: Write failing test**

Create `test/extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractAuthorFromHtml } from "../src/extract.js";

const fx = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("extractAuthorFromHtml — JSON-LD", () => {
  it("extracts author and email from schema.org/Article JSON-LD", () => {
    const r = extractAuthorFromHtml(
      fx("article-jsonld.html"),
      "https://example.com/jsonld",
    );
    expect(r.author).toBe("Ada Lovelace");
    expect(r.authorEmail).toBe("ada@example.com");
    expect(r.title).toBe("JSON-LD Article");
    expect(r.publishedAt).toBe("2026-04-01T10:00:00Z");
    expect(r.sourceUrl).toBe("https://example.com/jsonld");
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm test`
Expected: extract test fails (module not found).

- [ ] **Step 4: Implement src/extract.ts**

```ts
import * as cheerio from "cheerio";
import type { ExtractionResult } from "./types.js";

type PartialResult = Omit<ExtractionResult, "pageUrl">;

const GENERIC_MAILBOX_LOCAL_PARTS = new Set([
  "info", "editor", "editors", "tips", "news", "contact",
  "press", "newsroom", "support", "help", "admin", "office",
]);

function isGenericMailbox(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return GENERIC_MAILBOX_LOCAL_PARTS.has(local);
}

function tryJsonLd($: cheerio.CheerioAPI): {
  author?: string;
  authorEmail?: string;
  title?: string;
  publishedAt?: string;
} {
  const out: ReturnType<typeof tryJsonLd> = {};
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
      const node = candidate as Record<string, unknown>;
      const type = node["@type"];
      const isArticle =
        type === "Article" ||
        type === "NewsArticle" ||
        type === "BlogPosting" ||
        (Array.isArray(type) &&
          type.some((t) => typeof t === "string" && /Article|BlogPosting/.test(t)));
      if (!isArticle) continue;
      const author = node.author as
        | { name?: string; email?: string }
        | { name?: string; email?: string }[]
        | string
        | undefined;
      const first = Array.isArray(author) ? author[0] : author;
      if (typeof first === "string" && !out.author) out.author = first;
      else if (first && typeof first === "object") {
        if (first.name && !out.author) out.author = first.name;
        if (first.email && !out.authorEmail && !isGenericMailbox(first.email))
          out.authorEmail = first.email;
      }
      if (typeof node.headline === "string" && !out.title)
        out.title = node.headline;
      if (typeof node.datePublished === "string" && !out.publishedAt)
        out.publishedAt = node.datePublished;
    }
  });
  return out;
}

export function extractAuthorFromHtml(
  html: string,
  sourceUrl: string,
): PartialResult {
  const $ = cheerio.load(html);
  const result: PartialResult = { sourceUrl, author: "" };

  const jsonLd = tryJsonLd($);
  if (jsonLd.author) result.author = jsonLd.author;
  if (jsonLd.authorEmail) result.authorEmail = jsonLd.authorEmail;
  if (jsonLd.title) result.title = jsonLd.title;
  if (jsonLd.publishedAt) result.publishedAt = jsonLd.publishedAt;

  return result;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm test`
Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/extract.ts test/extract.test.ts test/fixtures/article-jsonld.html
git commit -m "feat(extract): JSON-LD heuristic with generic-mailbox filter"
```

---

## Task 7: Extract — meta tag heuristic (TDD)

**Files:**
- Modify: `src/extract.ts`, `test/extract.test.ts`
- Create: `test/fixtures/article-meta.html`

- [ ] **Step 1: Create fixture article-meta.html**

```html
<!DOCTYPE html>
<html><head>
  <title>Meta Article</title>
  <meta name="author" content="Grace Hopper">
  <meta property="article:author" content="Grace Hopper">
  <meta property="article:published_time" content="2026-03-15T08:00:00Z">
</head><body><h1>Hello</h1></body></html>
```

- [ ] **Step 2: Write failing test**

Append to `test/extract.test.ts`:

```ts
describe("extractAuthorFromHtml — meta tags", () => {
  it("falls back to <meta name=author> when no JSON-LD", () => {
    const r = extractAuthorFromHtml(
      fx("article-meta.html"),
      "https://example.com/meta",
    );
    expect(r.author).toBe("Grace Hopper");
    expect(r.title).toBe("Meta Article");
    expect(r.publishedAt).toBe("2026-03-15T08:00:00Z");
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm test`
Expected: new test fails — `r.author` is `""`.

- [ ] **Step 4: Add tryMeta to src/extract.ts**

Insert above `extractAuthorFromHtml`:

```ts
function tryMeta($: cheerio.CheerioAPI): {
  author?: string;
  title?: string;
  publishedAt?: string;
} {
  const out: ReturnType<typeof tryMeta> = {};
  const metaAuthor =
    $('meta[name="author"]').attr("content") ??
    $('meta[property="article:author"]').attr("content");
  if (metaAuthor && metaAuthor.trim()) out.author = metaAuthor.trim();
  const title = $("title").first().text().trim();
  if (title) out.title = title;
  const published = $('meta[property="article:published_time"]').attr("content");
  if (published) out.publishedAt = published;
  return out;
}
```

Update `extractAuthorFromHtml` body to use it after JSON-LD:

```ts
  const jsonLd = tryJsonLd($);
  if (jsonLd.author) result.author = jsonLd.author;
  if (jsonLd.authorEmail) result.authorEmail = jsonLd.authorEmail;
  if (jsonLd.title) result.title = jsonLd.title;
  if (jsonLd.publishedAt) result.publishedAt = jsonLd.publishedAt;

  const meta = tryMeta($);
  if (!result.author && meta.author) result.author = meta.author;
  if (!result.title && meta.title) result.title = meta.title;
  if (!result.publishedAt && meta.publishedAt) result.publishedAt = meta.publishedAt;

  return result;
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm test`
Expected: 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/extract.ts test/extract.test.ts test/fixtures/article-meta.html
git commit -m "feat(extract): meta-tag fallback for author/title/publishedAt"
```

---

## Task 8: Extract — CSS byline heuristic (TDD)

**Files:**
- Modify: `src/extract.ts`, `test/extract.test.ts`
- Create: `test/fixtures/article-css-byline.html`, `test/fixtures/article-no-author.html`

- [ ] **Step 1: Create fixture article-css-byline.html**

```html
<!DOCTYPE html>
<html><head><title>CSS Byline</title></head><body>
  <article>
    <p class="byline">By Linus Torvalds</p>
    <p>Lorem ipsum.</p>
  </article>
</body></html>
```

- [ ] **Step 2: Create fixture article-no-author.html**

```html
<!DOCTYPE html>
<html><head><title>No Author</title></head><body><p>Anonymous content.</p></body></html>
```

- [ ] **Step 3: Write failing tests**

Append to `test/extract.test.ts`:

```ts
describe("extractAuthorFromHtml — CSS fallback", () => {
  it("extracts from .byline element, stripping leading 'By '", () => {
    const r = extractAuthorFromHtml(
      fx("article-css-byline.html"),
      "https://example.com/css",
    );
    expect(r.author).toBe("Linus Torvalds");
  });

  it("returns empty author when no signal is present", () => {
    const r = extractAuthorFromHtml(
      fx("article-no-author.html"),
      "https://example.com/none",
    );
    expect(r.author).toBe("");
    expect(r.authorEmail).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests, verify the byline one fails**

Run: `npm test`
Expected: byline test fails (`""` ≠ `"Linus Torvalds"`); the no-author test already passes.

- [ ] **Step 5: Add tryCss to src/extract.ts**

Insert above `extractAuthorFromHtml`:

```ts
function tryCss($: cheerio.CheerioAPI): { author?: string } {
  const selectors = [
    '[rel="author"]',
    ".byline",
    ".author",
    ".article-author",
    "[itemprop=author]",
  ];
  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (text) {
      return { author: text.replace(/^by\s+/i, "").trim() };
    }
  }
  return {};
}
```

Update `extractAuthorFromHtml` to call it after meta:

```ts
  if (!result.author) {
    const css = tryCss($);
    if (css.author) result.author = css.author;
  }
```

(Place this block before `return result;`.)

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 13 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/extract.ts test/extract.test.ts test/fixtures/article-css-byline.html test/fixtures/article-no-author.html
git commit -m "feat(extract): CSS-selector byline fallback"
```

---

## Task 9: Extract — email heuristic (TDD)

**Files:**
- Modify: `src/extract.ts`, `test/extract.test.ts`
- Create: `test/fixtures/article-with-mailto.html`, `test/fixtures/article-with-generic-mailbox.html`

- [ ] **Step 1: Create fixture article-with-mailto.html**

```html
<!DOCTYPE html>
<html><head><title>Mailto</title></head><body>
  <article>
    <p class="byline">By Margaret Hamilton <a href="mailto:margaret@example.com">email</a></p>
  </article>
</body></html>
```

- [ ] **Step 2: Create fixture article-with-generic-mailbox.html**

```html
<!DOCTYPE html>
<html><head><title>Generic</title></head><body>
  <article>
    <p class="byline">By Editorial Team <a href="mailto:editor@example.com">contact</a></p>
  </article>
</body></html>
```

- [ ] **Step 3: Write failing tests**

Append to `test/extract.test.ts`:

```ts
describe("extractAuthorFromHtml — email", () => {
  it("extracts mailto: from byline-adjacent link", () => {
    const r = extractAuthorFromHtml(
      fx("article-with-mailto.html"),
      "https://example.com/mailto",
    );
    expect(r.author).toBe("Margaret Hamilton");
    expect(r.authorEmail).toBe("margaret@example.com");
  });

  it("ignores generic mailboxes (editor@, info@, etc.)", () => {
    const r = extractAuthorFromHtml(
      fx("article-with-generic-mailbox.html"),
      "https://example.com/generic",
    );
    expect(r.authorEmail).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `npm test`
Expected: mailto test fails (no email found).

- [ ] **Step 5: Add tryEmail to src/extract.ts**

Insert above `extractAuthorFromHtml`:

```ts
function tryEmail($: cheerio.CheerioAPI): { authorEmail?: string } {
  const bylineSelectors = [".byline", ".author", '[rel="author"]', "[itemprop=author]"];
  for (const sel of bylineSelectors) {
    const node = $(sel).first();
    if (!node.length) continue;
    const mailto = node
      .find('a[href^="mailto:"]')
      .attr("href")
      ?.replace(/^mailto:/, "")
      .split("?")[0];
    if (mailto && !isGenericMailbox(mailto)) return { authorEmail: mailto };
    const text = node.text();
    const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m && !isGenericMailbox(m[0])) return { authorEmail: m[0] };
  }
  return {};
}
```

Update `extractAuthorFromHtml` to call it after CSS:

```ts
  if (!result.authorEmail) {
    const email = tryEmail($);
    if (email.authorEmail) result.authorEmail = email.authorEmail;
  }
```

(Place before `return result;`.)

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 15 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/extract.ts test/extract.test.ts test/fixtures/article-with-*.html
git commit -m "feat(extract): mailto/email heuristic with generic-mailbox filter"
```

---

## Task 10: Extract — fetch wrapper

**Files:**
- Modify: `src/extract.ts`, `test/extract.test.ts`

- [ ] **Step 1: Add extractAuthor (fetch wrapper) to src/extract.ts**

Append to `src/extract.ts`:

```ts
export async function extractAuthor(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PartialResult> {
  const res = await fetchImpl(sourceUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${sourceUrl} failed: ${res.status}`);
  }
  const html = await res.text();
  return extractAuthorFromHtml(html, sourceUrl);
}
```

- [ ] **Step 2: Write a fetch-mock test**

Append to `test/extract.test.ts`:

```ts
import { extractAuthor } from "../src/extract.js";

describe("extractAuthor (fetch wrapper)", () => {
  it("uses injected fetch and parses HTML", async () => {
    const html = fx("article-jsonld.html");
    const fakeFetch = async () => new Response(html, { status: 200 });
    const r = await extractAuthor("https://example.com/jsonld", fakeFetch as typeof fetch);
    expect(r.author).toBe("Ada Lovelace");
  });

  it("throws on non-2xx", async () => {
    const fakeFetch = async () => new Response("nope", { status: 500 });
    await expect(
      extractAuthor("https://example.com/x", fakeFetch as typeof fetch),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 17 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/extract.ts test/extract.test.ts
git commit -m "feat(extract): fetch wrapper with timeout"
```

---

## Task 11: Sheet wrapper

**Files:**
- Create: `src/sheet.ts`

(No unit tests for `sheet.ts`; it is a thin wrapper over `googleapis`. The orchestrator test in Task 12 covers its contract via mocks.)

- [ ] **Step 1: Implement src/sheet.ts**

```ts
import { google, sheets_v4 } from "googleapis";
import type { ExtractionResult } from "./types.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export type SheetClient = {
  readSeenSourceUrls(): Promise<Set<string>>;
  appendRows(rows: ExtractionResult[]): Promise<void>;
};

const COLUMNS = [
  "author",
  "author_email",
  "source_url",
  "page_url",
  "title",
  "published_at",
  "extracted_at",
  "error",
] as const;

function rowFor(r: ExtractionResult): string[] {
  return [
    r.author,
    r.authorEmail ?? "",
    r.sourceUrl,
    r.pageUrl,
    r.title ?? "",
    r.publishedAt ?? "",
    new Date().toISOString(),
    r.error ?? "",
  ];
}

export async function makeSheetClient(opts: {
  spreadsheetId: string;
  tab: string;
}): Promise<SheetClient> {
  const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
  const sheets = google.sheets({ version: "v4", auth });
  await ensureHeaderRow(sheets, opts);
  return {
    readSeenSourceUrls: () => readSeenSourceUrls(sheets, opts),
    appendRows: (rows) => appendRows(sheets, opts, rows),
  };
}

async function ensureHeaderRow(
  sheets: sheets_v4.Sheets,
  opts: { spreadsheetId: string; tab: string },
) {
  const range = `${opts.tab}!A1:H1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.spreadsheetId,
    range,
  });
  const existing = res.data.values?.[0];
  if (!existing || existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: opts.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(COLUMNS)] },
    });
  }
}

async function readSeenSourceUrls(
  sheets: sheets_v4.Sheets,
  opts: { spreadsheetId: string; tab: string },
): Promise<Set<string>> {
  // source_url is column C (3rd)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.spreadsheetId,
    range: `${opts.tab}!C2:C`,
  });
  const values = res.data.values ?? [];
  return new Set(
    values
      .map((row) => row[0])
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );
}

async function appendRows(
  sheets: sheets_v4.Sheets,
  opts: { spreadsheetId: string; tab: string },
  rows: ExtractionResult[],
): Promise<void> {
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: opts.spreadsheetId,
    range: `${opts.tab}!A:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows.map(rowFor) },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/sheet.ts
git commit -m "feat(sheet): googleapis wrapper for read/append + header bootstrap"
```

---

## Task 12: Orchestrator (TDD)

**Files:**
- Create: `src/run.ts`, `test/run.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { run } from "../src/run.js";
import type { SheetClient } from "../src/sheet.js";

describe("run", () => {
  it("scrapes feeds, extracts authors for new URLs only, appends to sheet", async () => {
    const config = {
      feeds: [
        { pageUrl: "https://org.example/news", linkSelector: "a.x" },
      ],
    };
    const seen = new Set<string>(["https://other.com/seen"]);
    const appended: any[] = [];
    const sheet: SheetClient = {
      readSeenSourceUrls: async () => seen,
      appendRows: async (rows) => { appended.push(...rows); },
    };

    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u === "https://org.example/news") {
        return new Response(
          `<a class="x" href="https://other.com/new">N</a><a class="x" href="https://other.com/seen">S</a>`,
          { status: 200 },
        );
      }
      if (u === "https://other.com/new") {
        return new Response(
          `<html><head><meta name="author" content="Hopper"><title>T</title></head><body></body></html>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const summary = await run({ config, sheet, fetchImpl: fakeFetch as typeof fetch });

    expect(summary.feedsScanned).toBe(1);
    expect(summary.newLinks).toBe(1);
    expect(summary.successes).toBe(1);
    expect(summary.failures).toBe(0);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      sourceUrl: "https://other.com/new",
      author: "Hopper",
      pageUrl: "https://org.example/news",
    });
  });

  it("records extraction errors as rows with error populated", async () => {
    const config = {
      feeds: [{ pageUrl: "https://org.example/news", linkSelector: "a.x" }],
    };
    const appended: any[] = [];
    const sheet: SheetClient = {
      readSeenSourceUrls: async () => new Set<string>(),
      appendRows: async (rows) => { appended.push(...rows); },
    };

    const fakeFetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u === "https://org.example/news") {
        return new Response(`<a class="x" href="https://other.com/x">X</a>`, { status: 200 });
      }
      return new Response("server error", { status: 500 });
    };

    const summary = await run({ config, sheet, fetchImpl: fakeFetch as typeof fetch });
    expect(summary.failures).toBe(1);
    expect(appended).toHaveLength(1);
    expect(appended[0].error).toMatch(/500/);
    expect(appended[0].author).toBe("");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test`
Expected: run tests fail (module not found).

- [ ] **Step 3: Implement src/run.ts**

```ts
import type { AppConfig, ExtractionResult } from "./types.js";
import type { SheetClient } from "./sheet.js";
import { findLinks } from "./feeds.js";
import { extractAuthor } from "./extract.js";

export type RunSummary = {
  feedsScanned: number;
  newLinks: number;
  successes: number;
  failures: number;
};

export async function run(opts: {
  config: AppConfig;
  sheet: SheetClient;
  fetchImpl?: typeof fetch;
}): Promise<RunSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const seen = await opts.sheet.readSeenSourceUrls();
  const summary: RunSummary = {
    feedsScanned: 0,
    newLinks: 0,
    successes: 0,
    failures: 0,
  };
  const rows: ExtractionResult[] = [];

  for (const feed of opts.config.feeds) {
    summary.feedsScanned += 1;
    let sourceUrls: string[] = [];
    try {
      sourceUrls = await findLinks(feed, fetchImpl);
    } catch (err) {
      console.error(`[feed] ${feed.pageUrl}: ${(err as Error).message}`);
      continue;
    }
    const newSourceUrls = sourceUrls.filter((u) => !seen.has(u));
    summary.newLinks += newSourceUrls.length;

    for (const sourceUrl of newSourceUrls) {
      try {
        const partial = await extractAuthor(sourceUrl, fetchImpl);
        rows.push({ ...partial, pageUrl: feed.pageUrl });
        summary.successes += 1;
      } catch (err) {
        rows.push({
          sourceUrl,
          author: "",
          pageUrl: feed.pageUrl,
          error: (err as Error).message,
        });
        summary.failures += 1;
      }
      seen.add(sourceUrl);
    }
  }

  await opts.sheet.appendRows(rows);
  return summary;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/run.ts test/run.test.ts
git commit -m "feat(run): orchestrator with per-URL error handling"
```

---

## Task 13: CLI entry

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Implement src/cli.ts**

```ts
#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { makeSheetClient } from "./sheet.js";
import { run } from "./run.js";

const program = new Command();
program
  .name("byline")
  .description("Scrape configured pages, extract bylines, append to a Google Sheet.");

program
  .command("run")
  .description("Run a single pass over all configured feeds.")
  .option("-c, --config <path>", "path to config.json", "./config.json")
  .action(async (opts: { config: string }) => {
    const config = loadConfig(opts.config);
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const tab = process.env.GOOGLE_SHEET_TAB ?? "Sheet1";
    if (!spreadsheetId) {
      console.error("GOOGLE_SHEET_ID is required");
      process.exit(2);
    }
    const sheet = await makeSheetClient({ spreadsheetId, tab });
    const summary = await run({ config, sheet });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failures > 0) process.exitCode = 1;
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Verify CLI starts (without env vars set)**

Run: `npx tsx src/cli.ts run --config /nonexistent`
Expected: exits non-zero with an error mentioning the missing config file.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): commander entry point with run subcommand"
```

---

## Task 14: Example config and README

**Files:**
- Create: `config.json`, `README.md`

- [ ] **Step 1: Create example config.json**

```json
{
  "feeds": [
    {
      "pageUrl": "https://example.org/news",
      "linkSelector": "a.article-link",
      "linkPattern": "^https://[^/]+/(20\\d\\d|articles)/"
    }
  ]
}
```

- [ ] **Step 2: Create README.md**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add config.json README.md
git commit -m "docs: example config and README"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (target: 19 across config / feeds / extract / run).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exits 0; `dist/cli.js` exists.

- [ ] **Step 4: Audit**

Run: `.claude/skills/production-ready/scripts/production-audit.sh . quick`
Expected: passes (or only documents the absence of yet-unwritten artifacts).

- [ ] **Step 5: Push**

```bash
git push
```

---
