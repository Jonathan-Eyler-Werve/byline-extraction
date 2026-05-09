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
