import type { AppConfig, ExtractionResult } from "./types.js";
import type { SheetClient } from "./sheet.js";
import { findLinks } from "./feeds.js";
import { extractAuthor } from "./extract.js";

export type RunSummary = {
  feedsScanned: number;
  newLinks: number;
  successes: number;
  failures: number;
};

export type ProgressEvent =
  | { type: "sheet-read-start" }
  | { type: "sheet-read-done"; count: number }
  | { type: "feed-start"; pageUrl: string; index: number; total: number }
  | { type: "feed-links"; pageUrl: string; found: number; newCount: number }
  | { type: "feed-error"; pageUrl: string; error: string }
  | {
      type: "extract-result";
      index: number;
      total: number;
      sourceUrl: string;
      ok: boolean;
      result?: ExtractionResult;
      error?: string;
    }
  | { type: "persist-start"; rowCount: number }
  | { type: "persist-done"; rowCount: number };

export type RunOptions = {
  config: AppConfig;
  sheet: SheetClient;
  fetchImpl?: typeof fetch;
  onProgress?: (event: ProgressEvent) => void;
};

export async function run(opts: RunOptions): Promise<RunSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const emit = opts.onProgress ?? (() => {});

  emit({ type: "sheet-read-start" });
  const seen = await opts.sheet.readSeenSourceUrls();
  emit({ type: "sheet-read-done", count: seen.size });

  const summary: RunSummary = {
    feedsScanned: 0,
    newLinks: 0,
    successes: 0,
    failures: 0,
  };
  const rows: ExtractionResult[] = [];
  const totalFeeds = opts.config.feeds.length;

  for (let feedIdx = 0; feedIdx < totalFeeds; feedIdx++) {
    const feed = opts.config.feeds[feedIdx];
    summary.feedsScanned += 1;
    emit({
      type: "feed-start",
      pageUrl: feed.pageUrl,
      index: feedIdx + 1,
      total: totalFeeds,
    });

    let sourceUrls: string[] = [];
    try {
      sourceUrls = await findLinks(feed, fetchImpl);
    } catch (err) {
      emit({
        type: "feed-error",
        pageUrl: feed.pageUrl,
        error: (err as Error).message,
      });
      continue;
    }
    const newSourceUrls = sourceUrls.filter((u) => !seen.has(u));
    summary.newLinks += newSourceUrls.length;
    emit({
      type: "feed-links",
      pageUrl: feed.pageUrl,
      found: sourceUrls.length,
      newCount: newSourceUrls.length,
    });

    for (let i = 0; i < newSourceUrls.length; i++) {
      const sourceUrl = newSourceUrls[i];
      try {
        const partial = await extractAuthor(sourceUrl, fetchImpl);
        const result: ExtractionResult = { ...partial, pageUrl: feed.pageUrl };
        rows.push(result);
        summary.successes += 1;
        emit({
          type: "extract-result",
          index: i + 1,
          total: newSourceUrls.length,
          sourceUrl,
          ok: true,
          result,
        });
      } catch (err) {
        const error = (err as Error).message;
        rows.push({
          sourceUrl,
          author: "",
          pageUrl: feed.pageUrl,
          error,
        });
        summary.failures += 1;
        emit({
          type: "extract-result",
          index: i + 1,
          total: newSourceUrls.length,
          sourceUrl,
          ok: false,
          error,
        });
      }
      seen.add(sourceUrl);
    }
  }

  emit({ type: "persist-start", rowCount: rows.length });
  await opts.sheet.appendRows(rows);
  emit({ type: "persist-done", rowCount: rows.length });

  return summary;
}
