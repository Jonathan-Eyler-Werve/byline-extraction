import * as cheerio from "cheerio";
import type { FeedConfig } from "./types.js";

export function extractLinksFromHtml(
  html: string,
  baseUrl: string,
  feed: FeedConfig,
): string[] {
  const $ = cheerio.load(html);
  const selector = feed.linkSelector ?? "a[href]";
  const pattern = feed.linkPattern ? new RegExp(feed.linkPattern) : null;
  const out = new Set<string>();
  $(selector).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (pattern && !pattern.test(abs)) return;
    out.add(abs);
  });
  return [...out];
}
