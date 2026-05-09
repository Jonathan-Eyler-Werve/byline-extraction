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
