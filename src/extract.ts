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
      const author = node.author as
        | { name?: string; email?: string }
        | { name?: string; email?: string }[]
        | string
        | undefined;
      const first = Array.isArray(author) ? author[0] : author;
      if (typeof first === "string" && !out.author) out.author = first;
      else if (first && typeof first === "object") {
        if (first.name && !out.author) out.author = first.name;
        if (first.email && !out.authorEmail && !isGenericMailbox(first.email))
          out.authorEmail = first.email;
      }
      if (typeof node.headline === "string" && !out.title)
        out.title = node.headline;
      if (typeof node.datePublished === "string" && !out.publishedAt)
        out.publishedAt = node.datePublished;
    }
  });
  return out;
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

  return result;
}
