#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { makeWebhookSheetClient, makeDryRunSheetClient, type SheetClient } from "./sheet.js";
import { run } from "./run.js";

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
  .action(async (opts: { config: string; dryRun?: boolean }) => {
    const config = loadConfig(opts.config);
    let sheet: SheetClient;
    if (opts.dryRun) {
      sheet = makeDryRunSheetClient((rows) => {
        console.log(`[dry-run] would append ${rows.length} row(s):`);
        console.log(JSON.stringify(rows, null, 2));
      });
    } else {
      const webhookUrl = process.env.WEBHOOK_URL;
      if (!webhookUrl) {
        console.error("WEBHOOK_URL is required (or pass --dry-run). See apps-script/Code.gs for the webhook to deploy.");
        process.exit(2);
      }
      sheet = makeWebhookSheetClient({ webhookUrl });
    }
    const summary = await run({ config, sheet });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failures > 0) process.exitCode = 1;
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(2);
});
