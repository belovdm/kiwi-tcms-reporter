#!/usr/bin/env node
import type { KiwiSyncOptions } from "./types.js";
export declare const HELP = "kiwi-tcms-pipe \u2014 sync automated test results into Kiwi TCMS\n\nUsage:\n  kiwi-tcms-pipe [options] < results.(xml|json)\n  kiwi-tcms-pipe [options] --results <file>\n\nOptions:\n  --run <id>            existing TestRun id\n  --plan <id>           TestPlan id (with --build: find or create the run)\n  --build <name>        build name for plan mode (release tag, commit, \u2026)\n  --title <text>        run summary when auto-creating\n  --results <file>      results file (stdin if omitted)\n  --format <fmt>        junit | json | auto (default auto)\n  --match-by <mode>     auto | tag | title (default auto)\n  --create-missing      create a TestCase for unmatched tests\n  --dry-run             match only, write nothing\n  --close-run           set TestRun.stop_date after a successful sync\n  --strict              non-zero exit if unmatched tests or failed ops\n  -h, --help            this help\n\nEnv: KIWI_URL, KIWI_USERNAME, KIWI_PASSWORD, KIWI_PROJECT (required for plan mode),\n     KIWI_TIMEOUT, KIWI_INSECURE.\n\nMatching test \u2194 case:\n  1. ids in title/tags: C412, TC-412, KIWI:412, [C412];\n  2. exact, then partial, match of the case summary against the test title\n     (scoped to --plan or KIWI_PROJECT).\n\nJSON format:\n  { \"tests\": [ { \"title\", \"fullTitle?\", \"status\": \"passed|failed|skipped\",\n                 \"durationMs?\", \"error?\", \"tags\"?: [] } ] }\n  (also { \"results\": [...] } or a bare array;\n   pass/fail/skip/blocked/pending are normalized)\n";
export interface PipeArgs extends KiwiSyncOptions {
    resultsFile?: string;
    format?: string;
    strict?: boolean;
    help?: boolean;
}
export declare function parseArgs(argv: string[]): PipeArgs;
export declare function runPipe(args: PipeArgs, raw: string): Promise<number>;
