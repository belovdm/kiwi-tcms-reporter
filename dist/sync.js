import { extractId, extractName, KiwiClient } from "@kiwi-tcms-ai/kiwi-tcms-client";
import { applyInsecureTls, coerceBoolean, coerceNumber, configFromEnv } from "./config.js";
import { extractCaseIds } from "./marker.js";
const STATUS_BY_FRAMEWORK = {
    passed: "PASSED",
    failed: "FAILED",
    skipped: "BLOCKED",
    pending: "BLOCKED",
    todo: "BLOCKED",
    timedOut: "FAILED",
    interrupted: "FAILED",
};
const DEFAULT_STATUS_IDS = {
    IDLE: 1,
    RUNNING: 2,
    PAUSED: 3,
    PASSED: 4,
    FAILED: 5,
    BLOCKED: 6,
};
export class KiwiSync {
    client;
    statusMap = null;
    projectIdCache;
    constructor(client) {
        this.client = client;
    }
    async sync(results, opts) {
        const dryRun = opts.dryRun === true;
        const runId = await this.resolveRun(opts, results, dryRun);
        const entries = [];
        const unmatched = [];
        const byKiwiStatus = {};
        let matched = 0;
        let updated = 0;
        let createdCases = 0;
        let failedOps = 0;
        for (const t of results) {
            const kiwiStatus = STATUS_BY_FRAMEWORK[t.status] ?? "IDLE";
            byKiwiStatus[kiwiStatus] = (byKiwiStatus[kiwiStatus] ?? 0) + 1;
            const entry = {
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
                }
                else {
                    entry.caseId = found.id;
                    entry.caseSummary = found.summary;
                }
                matched++;
                const execId = await this.ensureExecution(runId, entry.caseId, dryRun);
                entry.executionId = execId;
                if (!dryRun && execId) {
                    await this.applyResult(execId, t, kiwiStatus, runId, opts);
                    updated++;
                }
                entry.ok = true;
                if (dryRun)
                    entry.note = [entry.note, "dry-run"].filter(Boolean).join(" · ");
            }
            catch (err) {
                entry.note = err.message;
                failedOps++;
            }
            entries.push(entry);
        }
        // Match the tool's own definition of "successful sync" (same as --strict):
        // no failed ops and no unmatched tests.
        const syncSucceeded = failedOps === 0 && unmatched.length === 0;
        let closed = false;
        if (opts.closeRun && !dryRun && syncSucceeded) {
            await this.client.call("TestRun.update", [runId, { stop_date: new Date().toISOString() }]);
            closed = true;
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
            closed,
            closeRequested: opts.closeRun === true,
        };
    }
    async resolveRun(opts, results, dryRun) {
        if (opts.run)
            return opts.run;
        if (opts.plan && opts.build) {
            const plans = await this.client.call("TestPlan.filter", [{ id: opts.plan }]);
            const plan = plans?.[0];
            if (!plan)
                throw new Error(`TestPlan ${opts.plan} not found.`);
            const productId = await this.projectId();
            // Kiwi 16+ Build references Version, not Product directly — prefer the
            // plan's own version. Older plans (or ones created without an explicit
            // product_version) fall back to any existing Version for the product.
            let versionId = extractId(plan.product_version);
            if (!versionId) {
                const versions = await this.client.call("Version.filter", [
                    { product: productId },
                ]);
                versionId = extractId(versions?.[0]?.id);
            }
            if (!versionId) {
                throw new Error(`TestPlan ${opts.plan} has no product_version and no Version exists for the ` +
                    "product — create one in Kiwi before creating a Build.");
            }
            let buildId = await this.findBuild(opts.build, productId, versionId);
            if (buildId && !dryRun) {
                const runs = await this.client.call("TestRun.filter", [
                    { plan: opts.plan, build: buildId, stop_date__isnull: true },
                ]);
                const existing = extractId(runs?.[0]?.id);
                if (existing)
                    return existing;
            }
            if (dryRun) {
                throw new Error("dry-run: no TestRun found or created. Pass --run <id> to preview without writes.");
            }
            if (!buildId) {
                buildId = await this.createBuild(opts.build, productId, versionId);
            }
            const managerId = await this.currentUserId();
            const run = await this.client.call("TestRun.create", [
                {
                    plan: opts.plan,
                    build: buildId,
                    summary: opts.runSummary ?? `Autosync ${new Date().toISOString()}`,
                    manager: managerId,
                    default_tester: managerId,
                },
            ]);
            const runId = extractId(run?.id);
            if (!runId)
                throw new Error("Failed to create TestRun");
            const caseIds = new Set();
            for (const t of results)
                for (const id of extractCaseIds(t))
                    caseIds.add(id);
            for (const cid of caseIds) {
                try {
                    await this.client.call("TestRun.add_case", [runId, cid]);
                }
                catch {
                    /* case may not exist yet */
                }
            }
            return runId;
        }
        throw new Error("Cannot resolve a TestRun: pass run (or --run), or plan + build (--plan/--build; KIWI_PROJECT is required).");
    }
    async findBuild(name, productId, versionId) {
        try {
            // Kiwi 16+: Build references Version, not Product directly.
            const rows = await this.client.call("Build.filter", [
                { name, version: versionId },
            ]);
            return extractId(rows?.[0]?.id);
        }
        catch {
            // Older Kiwi: Build has no version field, only product.
            const rows = await this.client.call("Build.filter", [
                { name, product: productId },
            ]);
            return extractId(rows?.[0]?.id);
        }
    }
    async createBuild(name, productId, versionId) {
        try {
            const created = await this.client.call("Build.create", [
                { name, version: versionId },
            ]);
            const id = extractId(created?.id);
            if (id)
                return id;
        }
        catch {
            /* older Kiwi: Build.create expects product, not version */
        }
        const created = await this.client.call("Build.create", [
            { name, product: productId },
        ]);
        const id = extractId(created?.id);
        if (!id)
            throw new Error("Failed to create Build");
        return id;
    }
    async currentUserId() {
        // User.filter with zero positional args resolves to the logged-in user.
        // Passing an empty-object filter (`[{}]`) is a different, unfiltered
        // listing call and returns an arbitrary user instead.
        const rows = await this.client.call("User.filter", []);
        const id = extractId(rows?.[0]?.id);
        if (!id) {
            throw new Error("Cannot resolve the logged-in user for TestRun.manager — User.filter returned no id.");
        }
        return id;
    }
    async projectId() {
        if (this.projectIdCache === undefined) {
            try {
                this.projectIdCache = await this.client.projectProductId();
            }
            catch {
                this.projectIdCache = null;
            }
        }
        if (this.projectIdCache === null) {
            throw new Error("KIWI_PROJECT is unset or the product was not found — needed to look up cases by title and to create builds/cases.");
        }
        return this.projectIdCache;
    }
    async findCase(t, opts) {
        const mode = opts.matchBy ?? "auto";
        if (mode !== "title") {
            const ids = extractCaseIds(t);
            if (ids.length) {
                const rows = await this.client.call("TestCase.filter", [{ id__in: ids }]);
                const first = rows?.[0];
                const id = extractId(first?.id);
                if (id)
                    return { id, summary: String(first?.summary ?? "") };
            }
            if (mode === "tag")
                return null;
        }
        const query = t.title.trim();
        if (!query)
            return null;
        const scope = await this.caseScope(opts);
        if (!scope)
            return null;
        const fromList = (rows) => {
            const first = rows?.[0];
            const id = extractId(first?.id);
            return id ? { id, summary: String(first?.summary ?? "") } : null;
        };
        const exact = await this.client.call("TestCase.filter", [
            { ...scope, summary__iexact: query },
        ]);
        return (fromList(exact) ??
            fromList(await this.client.call("TestCase.filter", [
                { ...scope, summary__icontains: query },
            ])));
    }
    async caseScope(opts) {
        if (opts.plan)
            return { plan: opts.plan };
        try {
            return { product: await this.projectId() };
        }
        catch {
            return null;
        }
    }
    async createCase(t, opts) {
        const productId = await this.projectId();
        const categories = await this.client.call("Category.filter", [
            { product: productId },
        ]);
        const categoryId = extractId(categories?.[0]?.id);
        const priorities = {};
        try {
            const rows = await this.client.call("Priority.filter", [{}]);
            for (const r of rows ?? []) {
                const id = extractId(r.id);
                const nm = extractName(r.value ?? r.name);
                if (id && nm)
                    priorities[nm.toLowerCase()] = id;
            }
        }
        catch {
            /* optional */
        }
        const priorityId = priorities.medium ?? priorities.p3 ?? priorities.normal;
        const values = {
            summary: (t.fullTitle || t.title).slice(0, 255),
            product: productId,
        };
        if (categoryId)
            values.category = categoryId;
        if (priorityId)
            values.priority = priorityId;
        const created = await this.client.call("TestCase.create", [
            values,
        ]);
        const id = extractId(created?.id);
        if (!id)
            return null;
        if (opts.plan) {
            try {
                await this.client.call("TestPlan.add_case", [opts.plan, id]);
            }
            catch {
                /* best effort */
            }
        }
        return { id, summary: String(created?.summary ?? values.summary) };
    }
    async ensureExecution(runId, caseId, dryRun) {
        const rows = await this.client.call("TestExecution.filter", [
            { run: runId, case: caseId },
        ]);
        const existing = extractId(rows?.[0]?.id);
        if (existing)
            return existing;
        if (dryRun)
            return undefined;
        await this.client.call("TestRun.add_case", [runId, caseId]);
        const again = await this.client.call("TestExecution.filter", [
            { run: runId, case: caseId },
        ]);
        return extractId(again?.[0]?.id);
    }
    async applyResult(executionId, t, kiwiStatus, runId, opts) {
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
        const isFailure = t.status === "failed" || t.status === "timedOut" || t.status === "interrupted";
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
    async statusId(name, runId) {
        if (!this.statusMap)
            this.statusMap = await this.buildStatusMap(runId);
        const id = this.statusMap.get(name.toUpperCase());
        if (!id) {
            throw new Error(`Status "${name}" not found. Available: ${[...this.statusMap.keys()].join(", ")}`);
        }
        return id;
    }
    async buildStatusMap(runId) {
        const map = new Map();
        const put = (id, name) => {
            const i = extractId(id);
            const n = extractName(name);
            if (i && n)
                map.set(String(n).toUpperCase(), i);
        };
        try {
            const rows = await this.client.call("TestExecutionStatus.filter", [{}]);
            for (const r of rows ?? []) {
                const o = r;
                put(o.id ?? o.value, o.name ?? o.value);
            }
            if (map.size)
                return map;
        }
        catch {
            /* method missing on older instances */
        }
        try {
            const execs = await this.client.call("TestExecution.filter", [{ run: runId }]);
            for (const e of execs ?? []) {
                const o = e;
                put(o.status_id, typeof o.status === "string" ? o.status : o.status);
            }
            if (map.size)
                return map;
            const firstId = extractId(execs?.[0]?.id);
            if (firstId) {
                const hist = await this.client.call("TestExecution.history", [firstId]);
                for (const h of hist ?? []) {
                    const o = h;
                    put(o.status_id, typeof o.status === "string" ? o.status : o.status);
                }
            }
        }
        catch {
            /* empty run or no access */
        }
        if (!map.size) {
            console.error("[kiwi] warning: could not resolve execution status ids from the API — using default Kiwi ids (IDLE=1 … BLOCKED=6).");
            for (const [n, i] of Object.entries(DEFAULT_STATUS_IDS))
                map.set(n, i);
        }
        return map;
    }
}
export async function runSync(results, rawOptions) {
    if (!results.length) {
        console.error("[kiwi] no results to sync to Kiwi TCMS");
        return;
    }
    try {
        const options = {
            ...rawOptions,
            run: coerceNumber(rawOptions.run) ?? rawOptions.run,
            plan: coerceNumber(rawOptions.plan) ?? rawOptions.plan,
            closeRun: coerceBoolean(rawOptions.closeRun) ?? rawOptions.closeRun,
        };
        const cfg = configFromEnv(options);
        applyInsecureTls();
        const client = new KiwiClient(cfg);
        const report = await new KiwiSync(client).sync(results, options);
        console.log(printReport(report));
    }
    catch (err) {
        console.error(`[kiwi] Kiwi TCMS sync failed: ${err.message}`);
    }
}
export function printReport(r) {
    const lines = [];
    lines.push("");
    lines.push(`[kiwi-tcms] ${r.dryRun ? "DRY-RUN · " : ""}run #${r.runId}: ${r.runUrl}`);
    lines.push(`[kiwi-tcms] tests: ${r.total} · matched: ${r.matched} · updated: ${r.updated}` +
        (r.createdCases ? ` · cases created: ${r.createdCases}` : "") +
        (r.failedOps ? ` · errors: ${r.failedOps}` : ""));
    const byStatus = Object.entries(r.byKiwiStatus)
        .map(([s, n]) => `${s}: ${n}`)
        .join(" · ");
    if (byStatus)
        lines.push(`[kiwi-tcms] ${byStatus}`);
    if (r.closed)
        lines.push("[kiwi-tcms] run closed");
    else if (r.closeRequested && !r.dryRun) {
        lines.push("[kiwi-tcms] run NOT closed — sync had errors or unmatched tests");
    }
    if (r.unmatched.length) {
        lines.push(`[kiwi-tcms] unmatched (${r.unmatched.length}):`);
        for (const u of r.unmatched.slice(0, 10))
            lines.push(`  - ${u}`);
        if (r.unmatched.length > 10)
            lines.push(`  … and ${r.unmatched.length - 10} more`);
    }
    lines.push("");
    return lines.join("\n");
}
