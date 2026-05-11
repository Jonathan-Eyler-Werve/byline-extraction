#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { makeWebhookSheetClient, makeDryRunSheetClient, type SheetClient } from "./sheet.js";
import { run, type ProgressEvent } from "./run.js";

const program = new Command();
program
  .name("byline")
  .description("Scrape configured pages, extract bylines, append to a Google Sheet via an Apps Script webhook.");

program
  .command("run")
  .description("Run a single pass over all configured feeds.")
  .option("-c, --config <path>", "path to config.json", "./config.json")
  .option(
    "--dry-run",
    "Don't read or write the sheet; print what would be appended. No webhook required.",
  )
  .option("-q, --quiet", "Suppress progress output; only print the JSON summary on stdout.")
  .option(
    "--retry-errors",
    "Re-attempt extraction for rows previously persisted with an error. Updates existing rows in place.",
  )
  .action(async (opts: { config: string; dryRun?: boolean; quiet?: boolean; retryErrors?: boolean }) => {
    const config = loadConfig(opts.config);
    let sheet: SheetClient;
    if (opts.dryRun) {
      sheet = makeDryRunSheetClient((rows) => {
        if (!opts.quiet) {
          process.stderr.write(`[dry-run] would append ${rows.length} row(s):\n`);
          process.stderr.write(JSON.stringify(rows, null, 2) + "\n");
        }
      });
    } else {
      const webhookUrl = process.env.WEBHOOK_URL;
      if (!webhookUrl) {
        console.error("WEBHOOK_URL is required (or pass --dry-run). See apps-script/Code.gs for the webhook to deploy.");
        process.exit(2);
      }
      const token = process.env.WEBHOOK_TOKEN || undefined;
      sheet = makeWebhookSheetClient({ webhookUrl, token });
    }

    if (!opts.quiet) {
      process.stderr.write(`byline-extraction fetches author name and email from outbound links.\n\n`);
      const n = config.feeds.length;
      process.stderr.write(`Config: ${n} feed${n === 1 ? "" : "s"}\n`);
      for (const f of config.feeds) {
        process.stderr.write(`  • ${f.pageUrl}\n`);
      }
      process.stderr.write(`\n`);
    }

    const onProgress = opts.quiet ? undefined : renderEvent;
    const summary = await run({
      config,
      sheet,
      onProgress,
      retryErrors: opts.retryErrors,
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failures > 0) process.exitCode = 1;
  });

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);

function renderEvent(e: ProgressEvent): void {
  switch (e.type) {
    case "sheet-read-start":
      process.stderr.write(`Reading seen URLs from sheet... `);
      break;
    case "sheet-read-done":
      process.stderr.write(`${e.count} known\n`);
      break;
    case "feed-start": {
      const label = e.title ? `${e.title} (${e.pageUrl})` : e.pageUrl;
      process.stderr.write(`\nFeed ${e.index}/${e.total}: ${label}\n`);
      break;
    }
    case "feed-links":
      process.stderr.write(`Found ${e.found} links, ${e.newCount} new.\nThis feed will take ~${Math.ceil(e.newCount / 3)} seconds.\n\n`);
      break;
    case "feed-error":
      process.stderr.write(`  Feed error: ${e.error}\n`);
      break;
    case "extract-result":
      if (e.ok) {
        process.stderr.write(`  [${e.index}/${e.total}] ${green("✓")} ${hostOf(e.sourceUrl)}\n`);
      } else {
        const reason =
          e.error?.replace(`fetch ${e.sourceUrl} failed: `, "").trim() ||
          e.error ||
          "unknown";
        process.stderr.write(`  [${e.index}/${e.total}] ${red("✗")} ${hostOf(e.sourceUrl)} — ${reason}\n`);
      }
      break;
    case "persist-start":
      process.stderr.write(`\nExtracted ${e.rowCount} row${e.rowCount === 1 ? "" : "s"}; persisting to sheet...\n`);
      break;
    case "persist-done":
      process.stderr.write(`Persisted: ${e.rowCount} row${e.rowCount === 1 ? "" : "s"} appended.\n\n`);
      break;
  }
}

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(2);
});
