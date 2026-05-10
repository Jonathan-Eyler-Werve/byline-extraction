import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractLinksFromHtml, findLinks } from "../src/feeds.js";

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
