import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractLinksFromHtml, findLinks } from "../src/feeds.js";

const fx = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("extractLinksFromHtml", () => {
  it("returns absolute URLs matching linkSelector (excluding same-host)", () => {
    const links = extractLinksFromHtml(
      fx("feed-with-selector.html"),
      "https://example.com/news",
      { pageUrl: "https://example.com/news", linkSelector: "a.article-link" },
    );
    // /articles/1 resolves to example.com (same host) and is filtered out;
    // only the external other.com link remains.
    expect(links).toEqual(["https://other.com/articles/2"]);
  });

  it("excludes links pointing to the same host as the feed page URL", () => {
    const html = `
      <a class="x" href="/about">About (relative, same host)</a>
      <a class="x" href="https://example.com/internal">Internal absolute</a>
      <a class="x" href="https://other.com/article">External</a>
    `;
    const links = extractLinksFromHtml(html, "https://example.com/news", {
      pageUrl: "https://example.com/news",
      linkSelector: "a.x",
    });
    expect(links).toEqual(["https://other.com/article"]);
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
    const html = `<a class="x" href="https://other.com/a">1</a><a class="x" href="https://other.com/a">2</a>`;
    const links = extractLinksFromHtml(html, "https://example.com", {
      pageUrl: "https://example.com",
      linkSelector: "a.x",
    });
    expect(links).toEqual(["https://other.com/a"]);
  });
});

describe("findLinks", () => {
  it("uses injected fetch and parses returned HTML", async () => {
    const fakeFetch = async () =>
      new Response(`<a class="x" href="https://other.com/a">A</a>`, { status: 200 });
    const links = await findLinks(
      { pageUrl: "https://example.com", linkSelector: "a.x" },
      fakeFetch as typeof fetch,
    );
    expect(links).toEqual(["https://other.com/a"]);
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

  it("sends a polite User-Agent header", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("", { status: 200 });
    };
    await findLinks(
      { pageUrl: "https://other.com", linkSelector: "a" },
      fakeFetch as typeof fetch,
    );
    expect(capturedHeaders?.["User-Agent"]).toMatch(/^byline-extraction\//);
  });
});
