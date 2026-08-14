import type { TestResult } from "./types.js";

/** Extract case ids from title / fullTitle / tags: C412, TC-412, KIWI:412, [C412]. */
export function extractCaseIds(t: Pick<TestResult, "title" | "fullTitle" | "tags">): number[] {
  const haystack = [t.fullTitle ?? "", t.title, ...(t.tags ?? [])].join(" ");
  const out = new Set<number>();
  const re = /\b(?:C|TC|KIWI)[\-_:]?(\d{2,7})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack))) {
    out.add(parseInt(m[1], 10));
  }
  return [...out];
}
