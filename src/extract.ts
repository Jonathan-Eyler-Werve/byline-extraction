import * as cheerio from "cheerio";
import type { ExtractionResult } from "./types.js";
import { USER_AGENT } from "./userAgent.js";

type PartialResult = Omit<ExtractionResult, "pageUrl">;

const GENERIC_MAILBOX_LOCAL_PARTS = new Set([
  "info", "editor", "editors", "tips", "news", "contact",
  "press", "newsroom", "support", "help", "admin", "office",
]);

function isGenericMailbox(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return GENERIC_MAILBOX_LOCAL_PARTS.has(local);
}

const GENERIC_AUTHOR_NAMES = new Set([
  "admin",
  "administrator",
  "editor",
  "editors",
  "editorial team",
  "staff",
  "newsroom",
  "contributor",
  "guest author",
  "all rights reserved",
  "privacy policy",
]);

function isGenericAuthorName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  return GENERIC_AUTHOR_NAMES.has(name.trim().toLowerCase());
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function jsonLdGetString(value: unknown, fields: readonly string[]): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const field of fields) {
      const nested = jsonLdGetString(obj[field], fields);
      if (nested) return nested;
    }
  }
  return undefined;
}

function jsonLdAuthorName(value: unknown): string | undefined {
  // schema.org typically uses .name; some sites wrap values as {@value:..., @language:...}.
  return jsonLdGetString(value, ["name", "@value"]);
}

function jsonLdAuthorEmail(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return jsonLdGetString(obj.email, ["@value"]);
  }
  return undefined;
}

function tryJsonLd($: cheerio.CheerioAPI): {
  author?: string;
  authorEmail?: string;
  title?: string;
  publishedAt?: string;
} {
  const out: ReturnType<typeof tryJsonLd> = {};
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
      const node = candidate as Record<string, unknown>;
      const type = node["@type"];
      const isArticle =
        type === "Article" ||
        type === "NewsArticle" ||
        type === "BlogPosting" ||
        (Array.isArray(type) &&
          type.some((t) => typeof t === "string" && /Article|BlogPosting/.test(t)));
      if (!isArticle) continue;
      const authorVal = node.author as
        | { name?: string; email?: string }
        | { name?: string; email?: string }[]
        | string
        | undefined;
      const authorList = Array.isArray(authorVal) ? authorVal : [authorVal];
      const names: string[] = [];
      for (const a of authorList) {
        if (!a) continue;
        const name = jsonLdAuthorName(a);
        if (name && !isGenericAuthorName(name)) names.push(name);
        const email = jsonLdAuthorEmail(a);
        if (email && !out.authorEmail && !isGenericMailbox(email)) {
          out.authorEmail = email;
        }
      }
      if (names.length && !out.author) out.author = names.join(", ");
      if (typeof node.headline === "string" && !out.title)
        out.title = node.headline;
      if (typeof node.datePublished === "string" && !out.publishedAt)
        out.publishedAt = node.datePublished;
    }
  });
  return out;
}

const CORPORATE_MARKERS_RE =
  /\b(?:inc|incorporated|ltd|llc|corp|corporation|company|co\.|group|media|network|publishing|press|news|magazine|newspaper|gmbh|holdings|enterprises|services|productions|studios)\b/i;

function isCorporateName(s: string): boolean {
  return CORPORATE_MARKERS_RE.test(s);
}

function tryCopyrightLine($: cheerio.CheerioAPI): { author?: string } {
  const root = $.root().clone();
  root.find("script, style, noscript").remove();
  const text = root.text();
  const re =
    /(?:copyright|©|\(c\))[\s,©]*\d{4}(?:\s*[-–—]\s*\d{4})?[\s,]+(?:by\s+)?([^./<\n;|]+?)(?:\s*\/|\.|<|\n|;|\||$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const candidate = match[1].trim().replace(/\s+/g, " ");
    if (!candidate) continue;
    if (isGenericAuthorName(candidate)) continue;
    if (isCorporateName(candidate)) continue;
    return { author: candidate };
  }
  return {};
}

function tryEmail($: cheerio.CheerioAPI): { authorEmail?: string } {
  const bylineSelectors = [".byline", ".author", '[rel="author"]', "[itemprop=author]"];
  for (const sel of bylineSelectors) {
    const node = $(sel).first();
    if (!node.length) continue;
    const mailto = node
      .find('a[href^="mailto:"]')
      .attr("href")
      ?.replace(/^mailto:/, "")
      .split("?")[0];
    if (mailto && !isGenericMailbox(mailto)) return { authorEmail: mailto };
    const text = node.text();
    const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m && !isGenericMailbox(m[0])) return { authorEmail: m[0] };
  }
  return {};
}

function tryCss($: cheerio.CheerioAPI): { author?: string } {
  const selectors = [
    '[rel="author"]',
    '[itemprop="author"] [itemprop="name"]',
    '[itemprop="author"]',
    '[data-p1-tag="Article_Byline"]',
    '[data-test="author-name"]',
    ".post-author",
    ".entry-author",
    ".article-author",
    ".author-name",
    ".authorText",
    ".link-LIBpto",
    ".node--view-mode-article-author",
    ".news-article__hero__bottom-meta-link",
    ".post-header__meta",
    ".page-info-header__author-title",
    ".byline__author",
    ".b-byline__names",
    ".byline-name",
    ".byline",
    ".author",
    ".h-card .p-name",
    ".vcard .fn",
    "address[class*=author]",
  ];
  for (const sel of selectors) {
    const node = $(sel).first();
    if (!node.length) continue;
    const clone = node.clone();
    clone.find('a[href^="mailto:"]').remove();
    const text = clone.text().trim();
    if (!text) continue;
    const candidate = text.replace(/^by\s+/i, "").trim();
    if (candidate && !isGenericAuthorName(candidate)) {
      return { author: candidate };
    }
  }
  return {};
}

function tryMeta($: cheerio.CheerioAPI): {
  author?: string;
  title?: string;
  publishedAt?: string;
} {
  const out: ReturnType<typeof tryMeta> = {};

  // Academic / Google Scholar convention: one <meta name="citation_author">
  // per author. Preferred when present.
  const citationAuthors: string[] = [];
  $('meta[name="citation_author"]').each((_, el) => {
    const content = $(el).attr("content")?.trim();
    if (content && !isGenericAuthorName(content)) {
      citationAuthors.push(content);
    }
  });
  if (citationAuthors.length > 0) {
    out.author = citationAuthors.join("; ");
  }

  if (!out.author) {
    const metaAuthor =
      $('meta[name="author"]').attr("content") ??
      $('meta[property="article:author"]').attr("content");
    const trimmedMetaAuthor = metaAuthor?.trim();
    if (trimmedMetaAuthor && !isGenericAuthorName(trimmedMetaAuthor)) {
      out.author = trimmedMetaAuthor;
    }
  }

  const title = $("title").first().text().trim();
  if (title) out.title = title;
  const published = $('meta[property="article:published_time"]').attr("content");
  if (published) out.publishedAt = published;
  return out;
}

export function extractAuthorFromHtml(
  html: string,
  sourceUrl: string,
): PartialResult {
  const $ = cheerio.load(html);
  const result: PartialResult = { sourceUrl, author: "" };

  const jsonLd = tryJsonLd($);
  if (jsonLd.author) result.author = jsonLd.author;
  if (jsonLd.authorEmail) result.authorEmail = jsonLd.authorEmail;
  if (jsonLd.title) result.title = jsonLd.title;
  if (jsonLd.publishedAt) result.publishedAt = jsonLd.publishedAt;

  const meta = tryMeta($);
  if (!result.author && meta.author) result.author = meta.author;
  if (!result.title && meta.title) result.title = meta.title;
  if (!result.publishedAt && meta.publishedAt) result.publishedAt = meta.publishedAt;

  if (!result.author) {
    const css = tryCss($);
    if (css.author) result.author = css.author;
  }

  if (!result.author) {
    const copyright = tryCopyrightLine($);
    if (copyright.author) result.author = copyright.author;
  }

  if (!result.authorEmail) {
    const email = tryEmail($);
    if (email.authorEmail) result.authorEmail = email.authorEmail;
  }

  if (result.author) result.author = collapseWhitespace(result.author);

  return result;
}

export async function extractAuthor(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PartialResult> {
  const res = await fetchImpl(sourceUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${sourceUrl} failed: ${res.status}`);
  }
  const html = await res.text();
  return extractAuthorFromHtml(html, sourceUrl);
}
