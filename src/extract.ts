import * as cheerio from "cheerio";
import type { ExtractionResult } from "./types.js";

type PartialResult = Omit<ExtractionResult, "pageUrl">;

const GENERIC_MAILBOX_LOCAL_PARTS = new Set([
  "info", "editor", "editors", "tips", "news", "contact",
  "press", "newsroom", "support", "help", "admin", "office",
]);

function isGenericMailbox(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return GENERIC_MAILBOX_LOCAL_PARTS.has(local);
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
        if (typeof a === "string") {
          names.push(a);
        } else if (typeof a === "object") {
          if (a.name) names.push(a.name);
          if (a.email && !out.authorEmail && !isGenericMailbox(a.email)) {
            out.authorEmail = a.email;
          }
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
    ".post-author",
    ".entry-author",
    ".article-author",
    ".author-name",
    ".byline__author",
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
    if (text) {
      return { author: text.replace(/^by\s+/i, "").trim() };
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
  const metaAuthor =
    $('meta[name="author"]').attr("content") ??
    $('meta[property="article:author"]').attr("content");
  if (metaAuthor && metaAuthor.trim()) out.author = metaAuthor.trim();
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

  if (!result.authorEmail) {
    const email = tryEmail($);
    if (email.authorEmail) result.authorEmail = email.authorEmail;
  }

  return result;
}

export async function extractAuthor(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PartialResult> {
  const res = await fetchImpl(sourceUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`fetch ${sourceUrl} failed: ${res.status}`);
  }
  const html = await res.text();
  return extractAuthorFromHtml(html, sourceUrl);
}
