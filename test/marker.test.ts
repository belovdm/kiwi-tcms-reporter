import { describe, expect, it } from "vitest";
import { extractCaseIds } from "../src/marker.js";

describe("extractCaseIds", () => {
  it("reads C412, TC-412, KIWI:412, and [C412] from title, fullTitle, and tags", () => {
    expect(extractCaseIds({ title: "pay by card [C412]" })).toEqual([412]);
    expect(extractCaseIds({ title: "TC-413 checkout" })).toEqual([413]);
    expect(
      extractCaseIds({
        title: "refund",
        fullTitle: "payments > KIWI:414 refund",
      }),
    ).toEqual([414]);
    expect(extractCaseIds({ title: "void", tags: ["@C415", "smoke"] })).toEqual([415]);
  });

  it("deduplicates ids found in several fields", () => {
    expect(
      extractCaseIds({
        title: "pay [C412]",
        fullTitle: "suite > pay [C412]",
        tags: ["C412"],
      }),
    ).toEqual([412]);
  });

  it("returns an empty list when no Kiwi marker is present", () => {
    expect(extractCaseIds({ title: "login works" })).toEqual([]);
  });
});
