#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { makeSheetClient } from "./sheet.js";
import { run } from "./run.js";

const program = new Command();
program
  .name("byline")
  .description("Scrape configured pages, extract bylines, append to a Google Sheet.");

program
  .command("run")
  .description("Run a single pass over all configured feeds.")
  .option("-c, --config <path>", "path to config.json", "./config.json")
  .action(async (opts: { config: string }) => {
    const config = loadConfig(opts.config);
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const tab = process.env.GOOGLE_SHEET_TAB ?? "Sheet1";
    if (!spreadsheetId) {
      console.error("GOOGLE_SHEET_ID is required");
      process.exit(2);
    }
    const sheet = await makeSheetClient({ spreadsheetId, tab });
    const summary = await run({ config, sheet });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failures > 0) process.exitCode = 1;
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(2);
});
