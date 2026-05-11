import * as cheerio from "cheerio";
import type { FeedConfig } from "./types.js";
import { USER_AGENT } from "./userAgent.js";

export function extractLinksFromHtml(
  html: string,
  baseUrl: string,
  feed: FeedConfig,
): string[] {
  const $ = cheerio.load(html);
  const selector = feed.linkSelector ?? "a[href]";
  const pattern = feed.linkPattern ? new RegExp(feed.linkPattern) : null;
  const baseHost = new URL(baseUrl).host;
  const out = new Set<string>();
  $(selector).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let absUrl: URL;
    try {
      absUrl = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (absUrl.host === baseHost) return;
    const abs = absUrl.toString();
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
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${feed.pageUrl} failed: ${res.status}`);
  }
  const html = await res.text();
  return extractLinksFromHtml(html, feed.pageUrl, feed);
}
