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
