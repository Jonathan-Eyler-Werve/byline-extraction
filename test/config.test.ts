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
