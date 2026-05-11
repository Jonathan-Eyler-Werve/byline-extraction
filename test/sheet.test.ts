import { describe, it, expect } from "vitest";
import { makeDryRunSheetClient, makeWebhookSheetClient } from "../src/sheet.js";
import type { ExtractionResult } from "../src/types.js";

describe("makeDryRunSheetClient", () => {
  it("returns an empty seen set so all found links count as new", async () => {
    const client = makeDryRunSheetClient();
    expect(await client.readSeenSourceUrls()).toEqual(new Set());
  });

  it("forwards appended rows to the onAppend callback", async () => {
    const captured: ExtractionResult[][] = [];
    const client = makeDryRunSheetClient((rows) => { captured.push(rows); });
    const row: ExtractionResult = {
      sourceUrl: "https://example.com/x",
      author: "Ada",
      pageUrl: "https://org.example/news",
    };
    await client.appendRows([row]);
    expect(captured).toEqual([[row]]);
  });

  it("works without an onAppend callback", async () => {
    const client = makeDryRunSheetClient();
    await expect(
      client.appendRows([
        { sourceUrl: "u", author: "a", pageUrl: "p" },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe("makeWebhookSheetClient", () => {
  it("readSeenSourceUrls GETs ?op=seen and returns the urls as a Set", async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      calls.push(url.toString());
      return new Response(JSON.stringify({ urls: ["a", "b"] }), { status: 200 });
    };
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      fetchImpl: fakeFetch as typeof fetch,
    });
    const seen = await c.readSeenSourceUrls();
    expect(seen).toEqual(new Set(["a", "b"]));
    expect(calls[0]).toBe("https://example.com/exec?op=seen");
  });

  it("appendRows POSTs JSON with op:append + rows", async () => {
    const requests: { url: string; method?: string; body?: string }[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: url.toString(),
        method: init?.method,
        body: init?.body as string,
      });
      return new Response(JSON.stringify({ appended: 1 }), { status: 200 });
    };
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await c.appendRows([
      { sourceUrl: "u", author: "Ada", pageUrl: "p" },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    const body = JSON.parse(requests[0].body!);
    expect(body.op).toBe("append");
    expect(body.rows[0].author).toBe("Ada");
  });

  it("appendRows skips the fetch entirely when rows is empty", async () => {
    let called = false;
    const fakeFetch = async () => { called = true; return new Response(""); };
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await c.appendRows([]);
    expect(called).toBe(false);
  });

  it("throws on non-2xx", async () => {
    const fakeFetch = async () => new Response("nope", { status: 500 });
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await expect(c.readSeenSourceUrls()).rejects.toThrow(/500/);
  });

  it("throws when the response body has an `error` field", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "denied" }), { status: 200 });
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await expect(c.readSeenSourceUrls()).rejects.toThrow(/denied/);
  });

  it("appends token to GET URL when provided", async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      calls.push(url.toString());
      return new Response(JSON.stringify({ urls: [] }), { status: 200 });
    };
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      token: "secret123",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await c.readSeenSourceUrls();
    expect(calls[0]).toContain("op=seen");
    expect(calls[0]).toContain("token=secret123");
  });

  it("appends token to POST URL when provided", async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(url.toString());
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ appended: 1 }), { status: 200 });
    };
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      token: "secret123",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await c.appendRows([
      { sourceUrl: "u", author: "a", pageUrl: "p" },
    ]);
    expect(calls[0]).toContain("token=secret123");
  });

  it("does not append a token when none is provided", async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      calls.push(url.toString());
      return new Response(JSON.stringify({ urls: [] }), { status: 200 });
    };
    const c = makeWebhookSheetClient({
      webhookUrl: "https://example.com/exec",
      fetchImpl: fakeFetch as typeof fetch,
    });
    await c.readSeenSourceUrls();
    expect(calls[0]).not.toContain("token=");
  });
});
