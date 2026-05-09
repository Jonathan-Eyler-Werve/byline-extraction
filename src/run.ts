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

export async function run(opts: {
  config: AppConfig;
  sheet: SheetClient;
  fetchImpl?: typeof fetch;
}): Promise<RunSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const seen = await opts.sheet.readSeenSourceUrls();
  const summary: RunSummary = {
    feedsScanned: 0,
    newLinks: 0,
    successes: 0,
    failures: 0,
  };
  const rows: ExtractionResult[] = [];

  for (const feed of opts.config.feeds) {
    summary.feedsScanned += 1;
    let sourceUrls: string[] = [];
    try {
      sourceUrls = await findLinks(feed, fetchImpl);
    } catch (err) {
      console.error(`[feed] ${feed.pageUrl}: ${(err as Error).message}`);
      continue;
    }
    const newSourceUrls = sourceUrls.filter((u) => !seen.has(u));
    summary.newLinks += newSourceUrls.length;

    for (const sourceUrl of newSourceUrls) {
      try {
        const partial = await extractAuthor(sourceUrl, fetchImpl);
        rows.push({ ...partial, pageUrl: feed.pageUrl });
        summary.successes += 1;
      } catch (err) {
        rows.push({
          sourceUrl,
          author: "",
          pageUrl: feed.pageUrl,
          error: (err as Error).message,
        });
        summary.failures += 1;
      }
      seen.add(sourceUrl);
    }
  }

  await opts.sheet.appendRows(rows);
  return summary;
}
