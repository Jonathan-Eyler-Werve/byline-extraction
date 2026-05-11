import { describe, it, expect, vi } from "vitest";
import { run, type ProgressEvent } from "../src/run.js";
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

  it("emits progress events in the expected order with payloads", async () => {
    const config = {
      feeds: [{ pageUrl: "https://org.example/news", linkSelector: "a.x" }],
    };
    const sheet: SheetClient = {
      readSeenSourceUrls: async () => new Set<string>(["https://other.com/seen"]),
      appendRows: async () => {},
    };
    const fakeFetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u === "https://org.example/news") {
        return new Response(
          `<a class="x" href="https://a.com/x">A</a><a class="x" href="https://other.com/seen">S</a><a class="x" href="https://b.com/x">B</a>`,
          { status: 200 },
        );
      }
      if (u === "https://a.com/x") {
        return new Response(
          `<html><head><meta name="author" content="Ada"></head></html>`,
          { status: 200 },
        );
      }
      return new Response("err", { status: 500 });
    };
    const events: ProgressEvent[] = [];
    await run({
      config,
      sheet,
      fetchImpl: fakeFetch as typeof fetch,
      onProgress: (e) => events.push(e),
    });
    expect(events.map((e) => e.type)).toEqual([
      "sheet-read-start",
      "sheet-read-done",
      "feed-start",
      "feed-links",
      "extract-result",
      "extract-result",
      "persist-start",
      "persist-done",
    ]);
    expect(events.find((e) => e.type === "sheet-read-done")).toMatchObject({ count: 1 });
    expect(events.find((e) => e.type === "feed-start")).toMatchObject({
      pageUrl: "https://org.example/news",
      index: 1,
      total: 1,
    });
    expect(events.find((e) => e.type === "feed-links")).toMatchObject({
      found: 3,
      newCount: 2,
    });
    const extractEvents = events.filter((e) => e.type === "extract-result");
    expect(extractEvents[0]).toMatchObject({ index: 1, total: 2, ok: true });
    expect(extractEvents[1]).toMatchObject({ index: 2, total: 2, ok: false });
    expect(events.find((e) => e.type === "persist-start")).toMatchObject({ rowCount: 2 });
    expect(events.find((e) => e.type === "persist-done")).toMatchObject({ rowCount: 2 });
  });

  it("persists after each feed instead of once at the end", async () => {
    const config = {
      feeds: [
        { pageUrl: "https://org.example/a", linkSelector: "a.x" },
        { pageUrl: "https://org.example/b", linkSelector: "a.x" },
      ],
    };
    const appendCalls: number[] = [];
    const sheet: SheetClient = {
      readSeenSourceUrls: async () => new Set<string>(),
      appendRows: async (rows) => { appendCalls.push(rows.length); },
    };
    const fakeFetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u === "https://org.example/a") {
        return new Response(`<a class="x" href="https://x.com/1">1</a>`, { status: 200 });
      }
      if (u === "https://org.example/b") {
        return new Response(
          `<a class="x" href="https://x.com/2">2</a><a class="x" href="https://x.com/3">3</a>`,
          { status: 200 },
        );
      }
      return new Response(`<html><head><meta name="author" content="A"></head></html>`, { status: 200 });
    };
    const events: ProgressEvent[] = [];
    await run({
      config,
      sheet,
      fetchImpl: fakeFetch as typeof fetch,
      onProgress: (e) => events.push(e),
    });
    // Two separate appendRows calls, one per feed, with the right sizes
    expect(appendCalls).toEqual([1, 2]);
    // persist events interleave with feed events
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "sheet-read-start",
      "sheet-read-done",
      "feed-start",
      "feed-links",
      "extract-result",
      "persist-start",
      "persist-done",
      "feed-start",
      "feed-links",
      "extract-result",
      "extract-result",
      "persist-start",
      "persist-done",
    ]);
  });

  it("skips the persist call entirely when a feed produces no rows", async () => {
    const config = {
      feeds: [{ pageUrl: "https://org.example/a", linkSelector: "a.x" }],
    };
    let appendCalled = false;
    const sheet: SheetClient = {
      readSeenSourceUrls: async () => new Set<string>(["https://x.com/already"]),
      appendRows: async () => { appendCalled = true; },
    };
    const fakeFetch = async () =>
      new Response(`<a class="x" href="https://x.com/already">A</a>`, { status: 200 });
    const events: ProgressEvent[] = [];
    await run({
      config,
      sheet,
      fetchImpl: fakeFetch as typeof fetch,
      onProgress: (e) => events.push(e),
    });
    expect(appendCalled).toBe(false);
    const types = events.map((e) => e.type);
    expect(types).not.toContain("persist-start");
    expect(types).not.toContain("persist-done");
  });

  it("passes retryErrors through to readSeenSourceUrls", async () => {
    let receivedOpts: { excludeErrors?: boolean } | undefined;
    const config = {
      feeds: [{ pageUrl: "https://org.example/news", linkSelector: "a.x" }],
    };
    const sheet: SheetClient = {
      readSeenSourceUrls: async (opts) => {
        receivedOpts = opts;
        return new Set<string>();
      },
      appendRows: async () => {},
    };
    const fakeFetch = async () => new Response("", { status: 200 });
    await run({
      config,
      sheet,
      fetchImpl: fakeFetch as typeof fetch,
      retryErrors: true,
    });
    expect(receivedOpts?.excludeErrors).toBe(true);
  });

  it("omits excludeErrors when retryErrors is not set", async () => {
    let receivedOpts: { excludeErrors?: boolean } | undefined;
    const config = {
      feeds: [{ pageUrl: "https://org.example/news", linkSelector: "a.x" }],
    };
    const sheet: SheetClient = {
      readSeenSourceUrls: async (opts) => {
        receivedOpts = opts;
        return new Set<string>();
      },
      appendRows: async () => {},
    };
    const fakeFetch = async () => new Response("", { status: 200 });
    await run({
      config,
      sheet,
      fetchImpl: fakeFetch as typeof fetch,
    });
    expect(receivedOpts?.excludeErrors).toBeFalsy();
  });

  it("emits feed-error and skips feed-links when feed fetch fails", async () => {
    const config = {
      feeds: [{ pageUrl: "https://org.example/news", linkSelector: "a.x" }],
    };
    const sheet: SheetClient = {
      readSeenSourceUrls: async () => new Set<string>(),
      appendRows: async () => {},
    };
    const fakeFetch = async () => new Response("nope", { status: 500 });
    const events: ProgressEvent[] = [];
    await run({
      config,
      sheet,
      fetchImpl: fakeFetch as typeof fetch,
      onProgress: (e) => events.push(e),
    });
    const types = events.map((e) => e.type);
    expect(types).toContain("feed-error");
    expect(types).not.toContain("feed-links");
    expect(events.find((e) => e.type === "feed-error")).toMatchObject({
      pageUrl: "https://org.example/news",
    });
  });
});
