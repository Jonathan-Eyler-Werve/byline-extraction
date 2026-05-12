import * as cheerio from "cheerio";

export type SocialColumn = "bluesky" | "instagram" | "linkedin" | "twitter";

export type SocialResult = Partial<Record<SocialColumn, string[]>>;

const SHARE_INTENT_MARKERS = [
  "/intent/",
  "/share",
  "/sharer.php",
  "intent/tweet",
  "intent/compose",
  "shareArticle",
];

function isShareIntent(url: URL): boolean {
  const pathAndQuery = url.pathname + url.search;
  for (const marker of SHARE_INTENT_MARKERS) {
    if (pathAndQuery.includes(marker)) return true;
  }
  if (url.searchParams.has("share")) return true;
  return false;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export function classifySocial(
  rawUrl: string,
): { column: SocialColumn; url: string } | null {
  if (!rawUrl || rawUrl === "#") return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (isShareIntent(url)) return null;
  const host = normalizeHost(url.host);
  const path = url.pathname;
  if (host === "twitter.com" || host === "x.com") {
    return { column: "twitter", url: rawUrl };
  }
  if (host === "instagram.com") {
    return { column: "instagram", url: rawUrl };
  }
  if (host === "linkedin.com") {
    if (path.startsWith("/in/") || path.startsWith("/company/")) {
      return { column: "linkedin", url: rawUrl };
    }
    return null;
  }
  if (host === "bsky.app") {
    if (path.startsWith("/profile/")) {
      return { column: "bluesky", url: rawUrl };
    }
    return null;
  }
  return null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectSameAs(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const same = obj.sameAs;
  if (typeof same === "string") return [same];
  if (Array.isArray(same)) return same.filter((s): s is string => typeof s === "string");
  return [];
}

function jsonLdSocials(
  $: cheerio.CheerioAPI,
  sink: Map<SocialColumn, Set<string>>,
): void {
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text();
    if (!text.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const candidates = Array.isArray(data) ? data : [data];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const node = candidate as Record<string, unknown>;
      const authors = asArray(node.author);
      const publishers = asArray(node.publisher);
      const allEntities = [...authors, ...publishers];
      for (const entity of allEntities) {
        for (const url of collectSameAs(entity)) {
          const classified = classifySocial(url);
          if (classified) sink.get(classified.column)!.add(classified.url);
        }
      }
    }
  });
}

const BYLINE_AREA_SELECTOR = [
  '[rel="author"]',
  '[itemprop="author"]',
  '.byline',
  '.author',
  '.Author-socialLinks',
  '.jeg_author_socials',
  '.author-bio',
  '.mvp-author-info-text',
  '.ArticlePage-authorInfo-bio',
  '[class*="PostByline_author"]',
  'address[class*=author]',
].join(", ");

function bylineAnchorSocials(
  $: cheerio.CheerioAPI,
  sink: Map<SocialColumn, Set<string>>,
): void {
  $(BYLINE_AREA_SELECTOR).each((_, area) => {
    $(area)
      .find("a[href]")
      .each((_, a) => {
        const href = $(a).attr("href");
        if (!href) return;
        const classified = classifySocial(href);
        if (classified) sink.get(classified.column)!.add(classified.url);
      });
  });
}

function emptySink(): Map<SocialColumn, Set<string>> {
  return new Map<SocialColumn, Set<string>>([
    ["bluesky", new Set()],
    ["instagram", new Set()],
    ["linkedin", new Set()],
    ["twitter", new Set()],
  ]);
}

function sinkToResult(sink: Map<SocialColumn, Set<string>>): SocialResult {
  const out: SocialResult = {};
  for (const [column, urls] of sink) {
    if (urls.size > 0) out[column] = [...urls];
  }
  return out;
}

export function extractSocials($: cheerio.CheerioAPI): SocialResult {
  const sink = emptySink();
  jsonLdSocials($, sink);
  bylineAnchorSocials($, sink);
  return sinkToResult(sink);
}

export function extractSocialsFromHtml(html: string): SocialResult {
  return extractSocials(cheerio.load(html));
}
