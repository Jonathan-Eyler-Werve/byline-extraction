import { readFileSync } from "fs";
import type { AppConfig } from "./types.js";

export function loadConfig(path: string): AppConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw.feeds || !Array.isArray(raw.feeds) || raw.feeds.length === 0) {
    throw new Error("config: at least one feed is required");
  }
  for (const [i, feed] of raw.feeds.entries()) {
    if (!feed.pageUrl || typeof feed.pageUrl !== "string") {
      throw new Error(`config: feeds[${i}].pageUrl is required`);
    }
    if (!feed.linkSelector && !feed.linkPattern) {
      throw new Error(`config: feeds[${i}] needs linkSelector or linkPattern`);
    }
  }
  return raw as AppConfig;
}
