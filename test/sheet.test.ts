import { describe, it, expect } from "vitest";
import { makeDryRunSheetClient } from "../src/sheet.js";
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
