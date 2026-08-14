#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { KiwiClient } from "@kiwi-tcms-ai/kiwi-tcms-client";
import { applyInsecureTls, configFromEnv } from "./config.js";
import { parseJunit, parseResultsJson } from "./parse.js";
import { KiwiSync, printReport } from "./sync.js";
import type { KiwiSyncOptions } from "./types.js";

export const HELP = `kiwi-tcms-pipe — sync automated test results into Kiwi TCMS

Usage:
  kiwi-tcms-pipe [options] < results.(xml|json)
  kiwi-tcms-pipe [options] --results <file>

Options:
  --run <id>            existing TestRun id
  --plan <id>           TestPlan id (with --build: find or create the run)
  --build <name>        build name for plan mode (release tag, commit, …)
  --title <text>        run summary when auto-creating
  --results <file>      results file (stdin if omitted)
  --format <fmt>        junit | json | auto (default auto)
  --match-by <mode>     auto | tag | title (default auto)
  --create-missing      create a TestCase for unmatched tests
  --dry-run             match only, write nothing
  --strict              non-zero exit if unmatched tests or failed ops
  -h, --help            this help

Env: KIWI_URL, KIWI_USERNAME, KIWI_PASSWORD, KIWI_PROJECT (required for plan mode),
     KIWI_TIMEOUT, KIWI_INSECURE.

Matching test ↔ case:
  1. ids in title/tags: C412, TC-412, KIWI:412, [C412];
  2. exact, then partial, match of the case summary against the test title
     (scoped to --plan or KIWI_PROJECT).

JSON format:
  { "tests": [ { "title", "fullTitle?", "status": "passed|failed|skipped",
                 "durationMs?", "error?", "tags"?: [] } ] }
  (also { "results": [...] } or a bare array;
   pass/fail/skip/blocked/pending are normalized)
`;

export interface PipeArgs extends KiwiSyncOptions {
  resultsFile?: string;
  format?: string;
  strict?: boolean;
  help?: boolean;
}

export function parseArgs(argv: string[]): PipeArgs {
  const out: PipeArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--run":
        out.run = parseInt(next(), 10);
        break;
      case "--plan":
        out.plan = parseInt(next(), 10);
        break;
      case "--build":
        out.build = next();
        break;
      case "--title":
        out.runSummary = next();
        break;
      case "--results":
        out.resultsFile = next();
        break;
      case "--format":
        out.format = next();
        break;
      case "--match-by":
        out.matchBy = next() as KiwiSyncOptions["matchBy"];
        break;
      case "--create-missing":
        out.createMissing = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--strict":
        out.strict = true;
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`[kiwi-pipe] unknown option: ${a} (see --help)`);
          process.exit(1);
        }
    }
  }
  return out;
}

export async function runPipe(args: PipeArgs, raw: string): Promise<number> {
  const format =
    !args.format || args.format === "auto"
      ? raw.trim().startsWith("<")
        ? "junit"
        : "json"
      : args.format;

  const results = format === "junit" ? parseJunit(raw) : parseResultsJson(raw);
  if (!results.length) {
    console.error(`[kiwi-pipe] no tests found in ${format} results`);
    return 1;
  }

  const cfg = configFromEnv(args);
  applyInsecureTls();
  const report = await new KiwiSync(new KiwiClient(cfg)).sync(results, args);
  console.log(printReport(report));

  if (args.strict && (report.unmatched.length > 0 || report.failedOps > 0)) return 1;
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const raw = args.resultsFile ? readFileSync(args.resultsFile, "utf8") : readFileSync(0, "utf8");
  const code = await runPipe(args, raw);
  if (code !== 0) process.exit(code);
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  main().catch((err) => {
    console.error(`[kiwi-pipe] error: ${(err as Error).message}`);
    process.exit(1);
  });
}
