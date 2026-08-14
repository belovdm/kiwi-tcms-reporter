import { describe, expect, it } from "vitest";
import { parseJunit, parseResultsJson } from "../src/parse.js";

describe("parseJunit", () => {
  it("maps passed, failed, errored, and skipped testcases", () => {
    const xml = `<?xml version="1.0"?>
<testsuite>
  <testcase classname="auth" name="login" time="0.25"/>
  <testcase name="pay [C412]" time="1.5">
    <failure message="expected 200">stack here</failure>
  </testcase>
  <testcase name="boom" time="0">
    <error message="ENOENT">no file</error>
  </testcase>
  <testcase name="later" time="0"><skipped/></testcase>
</testsuite>`;

    expect(parseJunit(xml)).toEqual([
      {
        title: "login",
        fullTitle: "auth > login",
        file: "auth",
        status: "passed",
        durationMs: 250,
        error: undefined,
      },
      {
        title: "pay [C412]",
        fullTitle: "pay [C412]",
        file: undefined,
        status: "failed",
        durationMs: 1500,
        error: "expected 200\nstack here",
      },
      {
        title: "boom",
        fullTitle: "boom",
        file: undefined,
        status: "failed",
        durationMs: 0,
        error: "ENOENT\nno file",
      },
      {
        title: "later",
        fullTitle: "later",
        file: undefined,
        status: "skipped",
        durationMs: 0,
        error: undefined,
      },
    ]);
  });
});

describe("parseResultsJson", () => {
  it("accepts { tests }, { results }, and a bare array", () => {
    const one = parseResultsJson(JSON.stringify({ tests: [{ title: "a", status: "pass" }] }));
    const two = parseResultsJson(JSON.stringify({ results: [{ name: "b", status: "ok" }] }));
    const three = parseResultsJson(JSON.stringify([{ title: "c", status: "success" }]));
    expect(one[0]).toMatchObject({ title: "a", status: "passed" });
    expect(two[0]).toMatchObject({ title: "b", status: "passed" });
    expect(three[0]).toMatchObject({ title: "c", status: "passed" });
  });

  it("normalizes status aliases and keeps tags", () => {
    const rows = parseResultsJson(
      JSON.stringify([
        { title: "f", status: "fail", durationMs: 10, error: "boom", tags: ["C1"] },
        { title: "s", status: "blocked" },
        { title: "t", status: "timeout" },
      ]),
    );
    expect(rows.map((r) => r.status)).toEqual(["failed", "skipped", "timedOut"]);
    expect(rows[0].tags).toEqual(["C1"]);
    expect(rows[0].durationMs).toBe(10);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseResultsJson("{")).toThrow(/valid JSON/i);
  });
});
