import { extractId, extractName, KiwiClient } from "@kiwi-tcms-ai/kiwi-tcms-client";
import { applyInsecureTls, coerceNumber, configFromEnv } from "./config.js";
import { extractCaseIds } from "./marker.js";
import type {
  FrameworkStatus,
  KiwiSyncOptions,
  SyncClient,
  SyncEntry,
  SyncReport,
  TestResult,
} from "./types.js";

export type { SyncClient, SyncEntry, SyncReport } from "./types.js";

const STATUS_BY_FRAMEWORK: Record<FrameworkStatus, string> = {
  passed: "PASSED",
  failed: "FAILED",
  skipped: "BLOCKED",
  pending: "BLOCKED",
  todo: "BLOCKED",
  timedOut: "FAILED",
  interrupted: "FAILED",
};

const DEFAULT_STATUS_IDS: Record<string, number> = {
  IDLE: 1,
  RUNNING: 2,
  PAUSED: 3,
  PASSED: 4,
  FAILED: 5,
  BLOCKED: 6,
};

export class KiwiSync {
  private statusMap: Map<string, number> | null = null;
  private projectIdCache: number | null | undefined;

  constructor(private client: SyncClient) {}

  async sync(results: TestResult[], opts: KiwiSyncOptions): Promise<SyncReport> {
    const dryRun = opts.dryRun === true;
    const runId = await this.resolveRun(opts, results, dryRun);

    const entries: SyncEntry[] = [];
    const unmatched: string[] = [];
    const byKiwiStatus: Record<string, number> = {};
    let matched = 0;
    let updated = 0;
    let createdCases = 0;
    let failedOps = 0;

    for (const t of results) {
      const kiwiStatus = STATUS_BY_FRAMEWORK[t.status] ?? "IDLE";
      byKiwiStatus[kiwiStatus] = (byKiwiStatus[kiwiStatus] ?? 0) + 1;

      const entry: SyncEntry = {
        test: t.fullTitle || t.title,
        frameworkStatus: t.status,
        kiwiStatus,
        ok: false,
      };

      try {
        const found = await this.findCase(t, opts);
        if (!found) {
          if (opts.createMissing && !dryRun) {
            const created = await this.createCase(t, opts);
            if (created) {
              entry.caseId = created.id;
              entry.caseSummary = created.summary;
              entry.note = `created case #${created.id}`;
              createdCases++;
            }
          }
          if (!entry.caseId) {
            entry.note = "case not found";
            unmatched.push(entry.test);
            entries.push(entry);
            continue;
          }
        } else {
          entry.caseId = found.id;
          entry.caseSummary = found.summary;
        }
        matched++;

        const execId = await this.ensureExecution(runId, entry.caseId!, dryRun);
        entry.executionId = execId;

        if (!dryRun && execId) {
          await this.applyResult(execId, t, kiwiStatus, runId, opts);
          updated++;
        }
        entry.ok = true;
        if (dryRun) entry.note = [entry.note, "dry-run"].filter(Boolean).join(" · ");
      } catch (err) {
        entry.note = (err as Error).message;
        failedOps++;
      }
      entries.push(entry);
    }

    return {
      runId,
      runUrl: `${this.client.endpoint.replace(/\/json-rpc\/$/, "")}/runs/${runId}/`,
      total: results.length,
      matched,
      updated,
      createdCases,
      failedOps,
      unmatched,
      byKiwiStatus,
      entries,
      dryRun,
    };
  }

  private async resolveRun(
    opts: KiwiSyncOptions,
    results: TestResult[],
    dryRun: boolean,
  ): Promise<number> {
    if (opts.run) return opts.run;

    if (opts.plan && opts.build) {
      const productId = await this.projectId();
      const builds = await this.client.call<unknown[]>("Build.filter", [
        { product: productId, name: opts.build },
      ]);
      let buildId = extractId((builds?.[0] as { id?: unknown } | undefined)?.id);

      if (buildId && !dryRun) {
        const runs = await this.client.call<unknown[]>("TestRun.filter", [
          { plan: opts.plan, build: buildId, stop_date__isnull: true },
        ]);
        const existing = extractId((runs?.[0] as { id?: unknown } | undefined)?.id);
        if (existing) return existing;
      }
      if (dryRun) {
        throw new Error(
          "dry-run: no TestRun found or created. Pass --run <id> to preview without writes.",
        );
      }

      if (!buildId) {
        const versions = await this.client.call<unknown[]>("Version.filter", [
          { product: productId },
        ]);
        const versionId = extractId((versions?.[0] as { id?: unknown } | undefined)?.id);
        if (!versionId) {
          throw new Error(
            "No Version exists for this product — create one in Kiwi before creating a Build.",
          );
        }
        const created = await this.client.call<{ id?: unknown }>("Build.create", [
          { name: opts.build, version: versionId },
        ]);
        buildId = extractId(created?.id);
        if (!buildId) throw new Error("Failed to create Build");
      }

      const run = await this.client.call<{ id?: unknown }>("TestRun.create", [
        {
          plan: opts.plan,
          build: buildId,
          summary: opts.runSummary ?? `Autosync ${new Date().toISOString()}`,
        },
      ]);
      const runId = extractId(run?.id);
      if (!runId) throw new Error("Failed to create TestRun");

      const caseIds = new Set<number>();
      for (const t of results) for (const id of extractCaseIds(t)) caseIds.add(id);
      for (const cid of caseIds) {
        try {
          await this.client.call("TestRun.add_case", [runId, cid]);
        } catch {
          /* case may not exist yet */
        }
      }
      return runId;
    }

    throw new Error(
      "Cannot resolve a TestRun: pass run (or --run), or plan + build (--plan/--build; KIWI_PROJECT is required).",
    );
  }

  private async projectId(): Promise<number> {
    if (this.projectIdCache === undefined) {
      try {
        this.projectIdCache = await this.client.projectProductId();
      } catch {
        this.projectIdCache = null;
      }
    }
    if (this.projectIdCache === null) {
      throw new Error(
        "KIWI_PROJECT is unset or the product was not found — needed to look up cases by title and to create builds/cases.",
      );
    }
    return this.projectIdCache;
  }

  private async findCase(
    t: TestResult,
    opts: KiwiSyncOptions,
  ): Promise<{ id: number; summary: string } | null> {
    const mode = opts.matchBy ?? "auto";

    if (mode !== "title") {
      const ids = extractCaseIds(t);
      if (ids.length) {
        const rows = await this.client.call<unknown[]>("TestCase.filter", [{ id__in: ids }]);
        const first = rows?.[0] as { id?: unknown; summary?: unknown } | undefined;
        const id = extractId(first?.id);
        if (id) return { id, summary: String(first?.summary ?? "") };
      }
      if (mode === "tag") return null;
    }

    const query = t.title.trim();
    if (!query) return null;
    const scope = await this.caseScope(opts);
    if (!scope) return null;

    const fromList = (rows: unknown[] | undefined) => {
      const first = rows?.[0] as { id?: unknown; summary?: unknown } | undefined;
      const id = extractId(first?.id);
      return id ? { id, summary: String(first?.summary ?? "") } : null;
    };
    const exact = await this.client.call<unknown[]>("TestCase.filter", [
      { ...scope, summary__iexact: query },
    ]);
    return (
      fromList(exact) ??
      fromList(
        await this.client.call<unknown[]>("TestCase.filter", [
          { ...scope, summary__icontains: query },
        ]),
      )
    );
  }

  private async caseScope(opts: KiwiSyncOptions): Promise<Record<string, unknown> | null> {
    if (opts.plan) return { plan: opts.plan };
    try {
      return { product: await this.projectId() };
    } catch {
      return null;
    }
  }

  private async createCase(
    t: TestResult,
    opts: KiwiSyncOptions,
  ): Promise<{ id: number; summary: string } | null> {
    const productId = await this.projectId();
    const categories = await this.client.call<unknown[]>("Category.filter", [
      { product: productId },
    ]);
    const categoryId = extractId((categories?.[0] as { id?: unknown } | undefined)?.id);

    const priorities: Record<string, number> = {};
    try {
      const rows = await this.client.call<unknown[]>("Priority.filter", [{}]);
      for (const r of rows ?? []) {
        const id = extractId((r as { id?: unknown }).id);
        const nm = extractName(
          (r as { value?: unknown; name?: unknown }).value ?? (r as { name?: unknown }).name,
        );
        if (id && nm) priorities[nm.toLowerCase()] = id;
      }
    } catch {
      /* optional */
    }
    const priorityId = priorities.medium ?? priorities.p3 ?? priorities.normal;

    const values: Record<string, unknown> = {
      summary: (t.fullTitle || t.title).slice(0, 255),
      product: productId,
    };
    if (categoryId) values.category = categoryId;
    if (priorityId) values.priority = priorityId;

    const created = await this.client.call<{ id?: unknown; summary?: unknown }>("TestCase.create", [
      values,
    ]);
    const id = extractId(created?.id);
    if (!id) return null;

    if (opts.plan) {
      try {
        await this.client.call("TestPlan.add_case", [opts.plan, id]);
      } catch {
        /* best effort */
      }
    }
    return { id, summary: String(created?.summary ?? values.summary) };
  }

  private async ensureExecution(
    runId: number,
    caseId: number,
    dryRun: boolean,
  ): Promise<number | undefined> {
    const rows = await this.client.call<unknown[]>("TestExecution.filter", [
      { run: runId, case: caseId },
    ]);
    const existing = extractId((rows?.[0] as { id?: unknown } | undefined)?.id);
    if (existing) return existing;
    if (dryRun) return undefined;

    await this.client.call("TestRun.add_case", [runId, caseId]);
    const again = await this.client.call<unknown[]>("TestExecution.filter", [
      { run: runId, case: caseId },
    ]);
    return extractId((again?.[0] as { id?: unknown } | undefined)?.id);
  }

  private async applyResult(
    executionId: number,
    t: TestResult,
    kiwiStatus: string,
    runId: number,
    opts: KiwiSyncOptions,
  ): Promise<void> {
    const statusId = await this.statusId(kiwiStatus, runId);
    const stop = new Date();
    const start = new Date(stop.getTime() - Math.max(0, t.durationMs ?? 0));

    await this.client.call("TestExecution.update", [
      executionId,
      {
        status: statusId,
        start_date: start.toISOString(),
        stop_date: stop.toISOString(),
      },
    ]);

    const isFailure =
      t.status === "failed" || t.status === "timedOut" || t.status === "interrupted";
    if (isFailure && t.error && opts.commentFailures !== false) {
      const limit = opts.limitErrorLength ?? 2000;
      const body = t.error.length > limit ? `${t.error.slice(0, limit)}\n… (truncated)` : t.error;
      const seconds = t.durationMs ? `${(t.durationMs / 1000).toFixed(1)} s` : "—";
      await this.client.call("TestExecution.add_comment", [
        executionId,
        `[autotest] ${kiwiStatus} · duration ${seconds}\n${body}`,
      ]);
    }
  }

  private async statusId(name: string, runId: number): Promise<number> {
    if (!this.statusMap) this.statusMap = await this.buildStatusMap(runId);
    const id = this.statusMap.get(name.toUpperCase());
    if (!id) {
      throw new Error(
        `Status "${name}" not found. Available: ${[...this.statusMap.keys()].join(", ")}`,
      );
    }
    return id;
  }

  private async buildStatusMap(runId: number): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const put = (id: unknown, name: unknown) => {
      const i = extractId(id);
      const n = extractName(name);
      if (i && n) map.set(String(n).toUpperCase(), i);
    };

    try {
      const rows = await this.client.call<unknown[]>("TestExecutionStatus.filter", [{}]);
      for (const r of rows ?? []) {
        const o = r as { id?: unknown; name?: unknown; value?: unknown };
        put(o.id ?? o.value, o.name ?? o.value);
      }
      if (map.size) return map;
    } catch {
      /* method missing on older instances */
    }

    try {
      const execs = await this.client.call<unknown[]>("TestExecution.filter", [{ run: runId }]);
      for (const e of execs ?? []) {
        const o = e as { status?: unknown; status_id?: unknown };
        put(o.status_id, typeof o.status === "string" ? o.status : o.status);
      }
      if (map.size) return map;

      const firstId = extractId((execs?.[0] as { id?: unknown } | undefined)?.id);
      if (firstId) {
        const hist = await this.client.call<unknown[]>("TestExecution.history", [firstId]);
        for (const h of hist ?? []) {
          const o = h as { status?: unknown; status_id?: unknown };
          put(o.status_id, typeof o.status === "string" ? o.status : o.status);
        }
      }
    } catch {
      /* empty run or no access */
    }

    if (!map.size) {
      console.error(
        "[kiwi] warning: could not resolve execution status ids from the API — using default Kiwi ids (IDLE=1 … BLOCKED=6).",
      );
      for (const [n, i] of Object.entries(DEFAULT_STATUS_IDS)) map.set(n, i);
    }
    return map;
  }
}

export async function runSync(results: TestResult[], rawOptions: KiwiSyncOptions): Promise<void> {
  if (!results.length) {
    console.error("[kiwi] no results to sync to Kiwi TCMS");
    return;
  }
  try {
    const options: KiwiSyncOptions = {
      ...rawOptions,
      run: coerceNumber(rawOptions.run) ?? rawOptions.run,
      plan: coerceNumber(rawOptions.plan) ?? rawOptions.plan,
    };
    const cfg = configFromEnv(options);
    applyInsecureTls();
    const client = new KiwiClient(cfg);
    const report = await new KiwiSync(client).sync(results, options);
    console.log(printReport(report));
  } catch (err) {
    console.error(`[kiwi] Kiwi TCMS sync failed: ${(err as Error).message}`);
  }
}

export function printReport(r: SyncReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`[kiwi-tcms] ${r.dryRun ? "DRY-RUN · " : ""}run #${r.runId}: ${r.runUrl}`);
  lines.push(
    `[kiwi-tcms] tests: ${r.total} · matched: ${r.matched} · updated: ${r.updated}` +
      (r.createdCases ? ` · cases created: ${r.createdCases}` : "") +
      (r.failedOps ? ` · errors: ${r.failedOps}` : ""),
  );
  const byStatus = Object.entries(r.byKiwiStatus)
    .map(([s, n]) => `${s}: ${n}`)
    .join(" · ");
  if (byStatus) lines.push(`[kiwi-tcms] ${byStatus}`);
  if (r.unmatched.length) {
    lines.push(`[kiwi-tcms] unmatched (${r.unmatched.length}):`);
    for (const u of r.unmatched.slice(0, 10)) lines.push(`  - ${u}`);
    if (r.unmatched.length > 10) lines.push(`  … and ${r.unmatched.length - 10} more`);
  }
  lines.push("");
  return lines.join("\n");
}
