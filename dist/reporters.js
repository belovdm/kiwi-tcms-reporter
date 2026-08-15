import { normalizeStatus } from "./parse.js";
import { runSync } from "./sync.js";
export class KiwiJestReporter {
    options;
    constructor(_globalConfig, options = {}) {
        this.options = options;
    }
    async onRunComplete(_contexts, results) {
        const mapped = [];
        for (const file of (results?.testResults ?? [])) {
            for (const t of (file.testResults ?? [])) {
                mapped.push({
                    title: t.title ?? "unknown",
                    fullTitle: [...(t.ancestorTitles ?? []), t.title ?? ""].filter(Boolean).join(" > "),
                    file: file.testFilePath,
                    status: normalizeStatus(t.status),
                    durationMs: t.duration ?? undefined,
                    error: (t.failureMessages ?? []).join("\n").trim() || undefined,
                });
            }
        }
        await runSync(mapped, this.options);
    }
}
export class KiwiPlaywrightReporter {
    options;
    collected = [];
    constructor(options = {}) {
        this.options = options;
    }
    onTestEnd(test, result) {
        const errs = result.errors?.length ? result.errors : result.error ? [result.error] : [];
        this.collected.push({
            title: test.title ?? "unknown",
            fullTitle: (test.titlePath?.() ?? [test.title ?? ""]).join(" > "),
            file: test.location?.file,
            status: normalizeStatus(result.status),
            durationMs: result.duration,
            error: errs
                .map((e) => e.stack || e.message || "")
                .join("\n")
                .trim() || undefined,
            tags: test.tags,
        });
    }
    async onEnd(_result) {
        await runSync(this.collected, this.options);
    }
}
export function kiwiMochaReporter(runner, options) {
    const collected = [];
    const push = (t, status, error) => {
        collected.push({
            title: t.title ?? "unknown",
            fullTitle: t.fullTitle?.(),
            file: t.file,
            status,
            durationMs: t.duration,
            error,
        });
    };
    runner.on("pass", (t) => push(t, "passed"));
    runner.on("fail", (t, err) => push(t, "failed", (err?.stack ||
        err?.message ||
        "")));
    runner.on("pending", (t) => push(t, "pending"));
    let finished = null;
    runner.on("end", () => {
        finished = runSync(collected, options?.reporterOptions ?? {});
    });
    this.done = (failures, fn) => {
        const p = finished ?? Promise.resolve();
        void p.finally(() => fn(failures));
    };
}
