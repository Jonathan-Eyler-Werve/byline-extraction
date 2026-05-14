import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractAuthorFromHtml, extractAuthor } from "../src/extract.js";

const fx = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

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

describe("extractAuthorFromHtml — JSON-LD", () => {
  it("extracts author and email from schema.org/Article JSON-LD", () => {
    const r = extractAuthorFromHtml(
      fx("article-jsonld.html"),
      "https://example.com/jsonld",
    );
    expect(r.author).toBe("Ada Lovelace");
    expect(r.authorEmail).toBe("ada@example.com");
    expect(r.title).toBe("JSON-LD Article");
    expect(r.publishedAt).toBe("2026-04-01");
    expect(r.sourceUrl).toBe("https://example.com/jsonld");
  });

  it("joins multiple JSON-LD authors with ', '", () => {
    const r = extractAuthorFromHtml(
      fx("article-jsonld-multi-author.html"),
      "https://example.com/multi",
    );
    expect(r.author).toBe("Ada Lovelace, Grace Hopper, Margaret Hamilton");
  });

  it("drops generic JSON-LD authors but keeps real ones from the same array", () => {
    const r = extractAuthorFromHtml(
      fx("article-jsonld-mixed-generic.html"),
      "https://example.com/mixed",
    );
    expect(r.author).toBe("Carol Smith");
  });

  it("extracts JSON-LD author.name from a nested @value structure", () => {
    const r = extractAuthorFromHtml(
      fx("article-jsonld-nested-name.html"),
      "https://example.com/nested",
    );
    expect(r.author).toBe("Jane Doe");
  });
});

describe("extractAuthorFromHtml — generic-name fallthrough", () => {
  it("skips a generic meta author (e.g. 'admin') and falls through to CSS byline", () => {
    const r = extractAuthorFromHtml(
      fx("article-generic-meta.html"),
      "https://example.com/generic-meta",
    );
    expect(r.author).toBe("Carol Smith");
  });
});

describe("extractAuthorFromHtml — copyright fallback", () => {
  it("extracts a personal name from a copyright line when no other signal exists", () => {
    const r = extractAuthorFromHtml(
      fx("article-copyright-only.html"),
      "https://example.com/copyright",
    );
    expect(r.author).toBe("John Baker");
  });

  it("ignores corporate copyright lines (Inc, Incorporated, Group, etc.)", () => {
    const r = extractAuthorFromHtml(
      fx("article-copyright-corporate.html"),
      "https://example.com/corp",
    );
    expect(r.author).toBe("");
  });
});

describe("extractAuthorFromHtml — meta tags", () => {
  it("falls back to <meta name=author> when no JSON-LD", () => {
    const r = extractAuthorFromHtml(
      fx("article-meta.html"),
      "https://example.com/meta",
    );
    expect(r.author).toBe("Grace Hopper");
    expect(r.title).toBe("Meta Article");
    expect(r.publishedAt).toBe("2026-03-15");
  });

  it("collects all <meta name=citation_author> tags joined with '; '", () => {
    const r = extractAuthorFromHtml(
      fx("article-meta-citation-authors.html"),
      "https://example.com/academic",
    );
    expect(r.author).toBe("Doe, Jane; Smith, John; Lee, Alex");
  });
});

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

  it("collapses whitespace in multi-line byline markup (NPR-style)", () => {
    const r = extractAuthorFromHtml(
      fx("article-css-multiline-byline.html"),
      "https://example.com/npr",
    );
    expect(r.author).toBe("Ashley Lopez , Benjamin Swasey");
  });

  it("extracts from .post-author (WordPress hentry pattern)", () => {
    const r = extractAuthorFromHtml(
      fx("article-post-author.html"),
      "https://example.com/wp",
    );
    expect(r.author).toBe("Stewart Brand");
  });

  it("extracts from .page-info-header__author-title", () => {
    const r = extractAuthorFromHtml(
      fx("article-page-info-header.html"),
      "https://example.com/page-info",
    );
    expect(r.author).toBe("Helen Mukerjee");
  });
});

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

  it("sends a polite User-Agent header", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("<html></html>", { status: 200 });
    };
    await extractAuthor("https://example.com/x", fakeFetch as typeof fetch);
    expect(capturedHeaders?.["User-Agent"]).toMatch(/^byline-extraction\//);
  });
});
