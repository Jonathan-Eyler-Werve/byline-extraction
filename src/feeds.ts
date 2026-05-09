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

export async function findLinks(
  feed: FeedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(feed.pageUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${feed.pageUrl} failed: ${res.status}`);
  }
  const html = await res.text();
  return extractLinksFromHtml(html, feed.pageUrl, feed);
}
