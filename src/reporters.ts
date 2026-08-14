import { normalizeStatus } from "./parse.js";
import { runSync } from "./sync.js";
import type { FrameworkStatus, KiwiSyncOptions, TestResult } from "./types.js";

export class KiwiJestReporter {
  constructor(
    _globalConfig: unknown,
    private options: KiwiSyncOptions = {},
  ) {}

  async onRunComplete(
    _contexts: unknown,
    results: { testResults?: unknown[] } | undefined,
  ): Promise<void> {
    const mapped: TestResult[] = [];
    for (const file of (results?.testResults ?? []) as Array<{
      testFilePath?: string;
      testResults?: unknown[];
    }>) {
      for (const t of (file.testResults ?? []) as Array<{
        title?: string;
        ancestorTitles?: string[];
        status?: string;
        duration?: number | null;
        failureMessages?: string[];
      }>) {
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
  private collected: TestResult[] = [];

  constructor(private options: KiwiSyncOptions = {}) {}

  onTestEnd(
    test: {
      title?: string;
      titlePath?: () => string[];
      location?: { file?: string };
      tags?: string[];
    },
    result: {
      status?: string;
      duration?: number;
      error?: { message?: string; stack?: string };
      errors?: Array<{ message?: string; stack?: string }>;
    },
  ): void {
    const errs = result.errors?.length ? result.errors : result.error ? [result.error] : [];
    this.collected.push({
      title: test.title ?? "unknown",
      fullTitle: (test.titlePath?.() ?? [test.title ?? ""]).join(" > "),
      file: test.location?.file,
      status: normalizeStatus(result.status),
      durationMs: result.duration,
      error:
        errs
          .map((e) => e.stack || e.message || "")
          .join("\n")
          .trim() || undefined,
      tags: test.tags,
    });
  }

  async onEnd(_result: unknown): Promise<void> {
    await runSync(this.collected, this.options);
  }
}

interface MochaRunnerLike {
  on(event: string, cb: (...args: unknown[]) => void): void;
}

export function kiwiMochaReporter(
  this: { done?: (failures: number, fn: (failures: number) => void) => void },
  runner: MochaRunnerLike,
  options?: { reporterOptions?: KiwiSyncOptions },
): void {
  const collected: TestResult[] = [];
  const push = (
    t: { title?: string; fullTitle?: () => string; file?: string; duration?: number },
    status: FrameworkStatus,
    error?: string,
  ) => {
    collected.push({
      title: t.title ?? "unknown",
      fullTitle: t.fullTitle?.(),
      file: t.file,
      status,
      durationMs: t.duration,
      error,
    });
  };

  runner.on("pass", (t) => push(t as never, "passed"));
  runner.on("fail", (t, err) =>
    push(
      t as never,
      "failed",
      ((err as { stack?: string; message?: string })?.stack ||
        (err as { message?: string })?.message ||
        "") as string,
    ),
  );
  runner.on("pending", (t) => push(t as never, "pending"));

  let finished: Promise<void> | null = null;
  runner.on("end", () => {
    finished = runSync(collected, options?.reporterOptions ?? {});
  });

  this.done = (failures: number, fn: (failures: number) => void) => {
    const p = finished ?? Promise.resolve();
    void p.finally(() => fn(failures));
  };
}
