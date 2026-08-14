import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/pipe.js";

describe("parseArgs", () => {
  it("parses run/plan/build/results/format flags", () => {
    expect(
      parseArgs([
        "--run",
        "93",
        "--plan",
        "12",
        "--build",
        "rc1",
        "--results",
        "out.xml",
        "--format",
        "junit",
      ]),
    ).toMatchObject({
      run: 93,
      plan: 12,
      build: "rc1",
      resultsFile: "out.xml",
      format: "junit",
    });
  });

  it("parses boolean flags", () => {
    expect(
      parseArgs(["--create-missing", "--dry-run", "--strict", "--match-by", "tag"]),
    ).toMatchObject({
      createMissing: true,
      dryRun: true,
      strict: true,
      matchBy: "tag",
    });
  });
});
