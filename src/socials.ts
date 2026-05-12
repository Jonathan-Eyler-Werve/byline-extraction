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
