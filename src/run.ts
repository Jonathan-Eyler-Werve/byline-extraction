import type { AppConfig, ExtractionResult, FeedConfig } from "./types.js";
import type { SheetClient } from "./sheet.js";
import { findLinks } from "./feeds.js";
import { extractAuthor } from "./extract.js";
import { classifyFetchError } from "./fetchError.js";

export type RunSummary = {
  feedsScanned: number;
  newLinks: number;
  successes: number;
  failures: number;
};

export type ProgressEvent =
  | { type: "sheet-read-start" }
  | { type: "sheet-read-done"; count: number }
  | { type: "feed-start"; pageUrl: string; title?: string; index: number; total: number }
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
  retryErrors?: boolean;
};

type FeedCounts = { newLinks: number; successes: number; failures: number };

async function processFeed(
  feed: FeedConfig,
  feedIdx: number,
  totalFeeds: number,
  seen: Set<string>,
  sheet: SheetClient,
  emit: (event: ProgressEvent) => void,
  fetchImpl: typeof fetch,
): Promise<FeedCounts> {
  emit({
    type: "feed-start",
    pageUrl: feed.pageUrl,
    title: feed.title,
    index: feedIdx + 1,
    total: totalFeeds,
  });

  let sourceUrls: string[];
  try {
    sourceUrls = await findLinks(feed, fetchImpl);
  } catch (err) {
    emit({
      type: "feed-error",
      pageUrl: feed.pageUrl,
      error: classifyFetchError(err),
    });
    return { newLinks: 0, successes: 0, failures: 0 };
  }
  const newSourceUrls = sourceUrls.filter((u) => !seen.has(u));
  emit({
    type: "feed-links",
    pageUrl: feed.pageUrl,
    found: sourceUrls.length,
    newCount: newSourceUrls.length,
  });

  let successes = 0;
  let failures = 0;
  const feedRows: ExtractionResult[] = [];

  for (let i = 0; i < newSourceUrls.length; i++) {
    const sourceUrl = newSourceUrls[i];
    try {
      const partial = await extractAuthor(sourceUrl, fetchImpl);
      const result: ExtractionResult = {
        ...partial,
        pageUrl: feed.pageUrl,
        feedTitle: feed.title,
      };
      feedRows.push(result);
      successes += 1;
      emit({
        type: "extract-result",
        index: i + 1,
        total: newSourceUrls.length,
        sourceUrl,
        ok: true,
        result,
      });
    } catch (err) {
      const error = classifyFetchError(err);
      feedRows.push({
        sourceUrl,
        author: "",
        pageUrl: feed.pageUrl,
        feedTitle: feed.title,
        error,
      });
      failures += 1;
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

  if (feedRows.length > 0) {
    emit({ type: "persist-start", rowCount: feedRows.length });
    await sheet.appendRows(feedRows);
    emit({ type: "persist-done", rowCount: feedRows.length });
  }

  return { newLinks: newSourceUrls.length, successes, failures };
}

export async function run(opts: RunOptions): Promise<RunSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const emit = opts.onProgress ?? (() => {});

  emit({ type: "sheet-read-start" });
  const seen = await opts.sheet.readSeenSourceUrls(
    opts.retryErrors ? { excludeErrors: true } : undefined,
  );
  emit({ type: "sheet-read-done", count: seen.size });

  const summary: RunSummary = {
    feedsScanned: 0,
    newLinks: 0,
    successes: 0,
    failures: 0,
  };
  const totalFeeds = opts.config.feeds.length;
  for (let feedIdx = 0; feedIdx < totalFeeds; feedIdx++) {
    summary.feedsScanned += 1;
    const counts = await processFeed(
      opts.config.feeds[feedIdx],
      feedIdx,
      totalFeeds,
      seen,
      opts.sheet,
      emit,
      fetchImpl,
    );
    summary.newLinks += counts.newLinks;
    summary.successes += counts.successes;
    summary.failures += counts.failures;
  }

  return summary;
}
