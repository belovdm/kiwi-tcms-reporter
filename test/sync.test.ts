import { describe, expect, it } from "vitest";
import { KiwiSync, printReport, type SyncClient } from "../src/sync.js";

interface RpcCall {
  method: string;
  params: unknown;
}

function fakeClient(
  handler: (call: RpcCall) => unknown,
  extras: Partial<SyncClient> = {},
): SyncClient & { calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    endpoint: "https://kiwi.example/json-rpc/",
    async projectProductId() {
      return 7;
    },
    async call(method, params = []) {
      const rec = { method, params };
      calls.push(rec);
      return handler(rec) as never;
    },
    ...extras,
    calls,
  };
}

describe("KiwiSync", () => {
  it("matches C412, updates the execution, and comments on failure", async () => {
    const client = fakeClient((call) => {
      if (call.method === "TestCase.filter") return [{ id: 412, summary: "Pay by card" }];
      if (call.method === "TestExecution.filter") return [{ id: 9001 }];
      if (call.method === "TestExecutionStatus.filter")
        return [
          { id: 4, name: "PASSED" },
          { id: 5, name: "FAILED" },
          { id: 6, name: "BLOCKED" },
        ];
      if (call.method === "TestExecution.update") return { id: 9001 };
      if (call.method === "TestExecution.add_comment") return true;
      throw new Error(`unexpected ${call.method}`);
    });

    const report = await new KiwiSync(client).sync(
      [
        {
          title: "pay by card [C412]",
          status: "failed",
          durationMs: 1500,
          error: "expected 200 got 500",
        },
      ],
      { run: 93 },
    );

    expect(report.runId).toBe(93);
    expect(report.runUrl).toBe("https://kiwi.example/runs/93/");
    expect(report.matched).toBe(1);
    expect(report.updated).toBe(1);
    expect(report.unmatched).toEqual([]);
    expect(report.entries[0]).toMatchObject({
      caseId: 412,
      executionId: 9001,
      kiwiStatus: "FAILED",
      ok: true,
    });

    const methods = client.calls.map((c) => c.method);
    expect(methods).toContain("TestExecution.update");
    expect(methods).toContain("TestExecution.add_comment");
  });

  it("dry-run matches but does not update or create", async () => {
    const client = fakeClient((call) => {
      if (call.method === "TestCase.filter") return [{ id: 412, summary: "Pay by card" }];
      if (call.method === "TestExecution.filter") return [{ id: 9001 }];
      throw new Error(`unexpected ${call.method}`);
    });

    const report = await new KiwiSync(client).sync([{ title: "pay [C412]", status: "passed" }], {
      run: 93,
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.matched).toBe(1);
    expect(report.updated).toBe(0);
    expect(client.calls.map((c) => c.method)).toEqual(["TestCase.filter", "TestExecution.filter"]);
  });

  it("lists unmatched tests when no case is found", async () => {
    const client = fakeClient((call) => {
      if (call.method === "TestCase.filter") return [];
      throw new Error(`unexpected ${call.method}`);
    });

    const report = await new KiwiSync(client).sync([{ title: "orphan test", status: "passed" }], {
      run: 93,
      matchBy: "tag",
    });

    expect(report.matched).toBe(0);
    expect(report.unmatched).toEqual(["orphan test"]);
    expect(report.entries[0].ok).toBe(false);
  });

  it("createMissing creates a case and attaches it to the plan", async () => {
    const client = fakeClient((call) => {
      if (call.method === "TestCase.filter") return [];
      if (call.method === "Category.filter") return [{ id: 2 }];
      if (call.method === "Priority.filter") return [{ id: 3, value: "Medium" }];
      if (call.method === "TestCase.create") return { id: 501, summary: "New flow" };
      if (call.method === "TestPlan.add_case") return true;
      if (call.method === "TestExecution.filter") return [];
      if (call.method === "TestRun.add_case") return true;
      if (call.method === "TestExecutionStatus.filter") return [{ id: 4, name: "PASSED" }];
      if (call.method === "TestExecution.update") return {};
      throw new Error(`unexpected ${call.method}`);
    });

    const report = await new KiwiSync(client).sync(
      [{ title: "New flow", fullTitle: "New flow", status: "passed" }],
      {
        run: 93,
        plan: 12,
        createMissing: true,
        matchBy: "tag",
      },
    );

    expect(report.createdCases).toBe(1);
    expect(report.matched).toBe(1);
    expect(client.calls.some((c) => c.method === "TestCase.create")).toBe(true);
    expect(client.calls.some((c) => c.method === "TestPlan.add_case")).toBe(true);
  });

  it("reuses an active run for plan + build", async () => {
    const client = fakeClient((call) => {
      if (call.method === "Build.filter") return [{ id: 8, name: "1.4.2-rc1" }];
      if (call.method === "TestRun.filter") return [{ id: 77 }];
      if (call.method === "TestCase.filter") return [{ id: 412, summary: "Pay" }];
      if (call.method === "TestExecution.filter") return [{ id: 1 }];
      if (call.method === "TestExecutionStatus.filter") return [{ id: 4, name: "PASSED" }];
      if (call.method === "TestExecution.update") return {};
      throw new Error(`unexpected ${call.method}`);
    });

    const report = await new KiwiSync(client).sync([{ title: "pay [C412]", status: "passed" }], {
      plan: 12,
      build: "1.4.2-rc1",
    });

    expect(report.runId).toBe(77);
    expect(client.calls.some((c) => c.method === "TestRun.create")).toBe(false);
  });

  it("creates a missing build and run, then adds tagged cases", async () => {
    const client = fakeClient((call) => {
      if (call.method === "Build.filter") return [];
      if (call.method === "Version.filter") return [{ id: 3 }];
      if (call.method === "Build.create") return { id: 9 };
      if (call.method === "TestRun.create") return { id: 80 };
      if (call.method === "TestRun.add_case") return true;
      if (call.method === "TestCase.filter") return [{ id: 412, summary: "Pay" }];
      if (call.method === "TestExecution.filter") return [{ id: 1 }];
      if (call.method === "TestExecutionStatus.filter") return [{ id: 4, name: "PASSED" }];
      if (call.method === "TestExecution.update") return {};
      throw new Error(`unexpected ${call.method}`);
    });

    const report = await new KiwiSync(client).sync([{ title: "pay [C412]", status: "passed" }], {
      plan: 12,
      build: "1.4.2-rc1",
    });

    expect(report.runId).toBe(80);
    expect(client.calls.some((c) => c.method === "Build.create")).toBe(true);
    expect(client.calls.some((c) => c.method === "TestRun.create")).toBe(true);
  });

  it("dry-run without --run throws when no active run exists", async () => {
    const client = fakeClient((call) => {
      if (call.method === "Build.filter") return [];
      throw new Error(`unexpected ${call.method}`);
    });

    await expect(
      new KiwiSync(client).sync([{ title: "pay [C412]", status: "passed" }], {
        plan: 12,
        build: "dev",
        dryRun: true,
      }),
    ).rejects.toThrow(/dry-run/i);
  });

  it("printReport includes run url, counts, and unmatched titles", () => {
    const text = printReport({
      runId: 93,
      runUrl: "https://kiwi.example/runs/93/",
      total: 2,
      matched: 1,
      updated: 1,
      createdCases: 0,
      failedOps: 0,
      unmatched: ["orphan"],
      byKiwiStatus: { PASSED: 1, FAILED: 1 },
      entries: [],
      dryRun: false,
    });
    expect(text).toContain("run #93");
    expect(text).toContain("https://kiwi.example/runs/93/");
    expect(text).toContain("unmatched (1)");
    expect(text).toContain("orphan");
  });
});
