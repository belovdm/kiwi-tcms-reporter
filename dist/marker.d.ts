import type { TestResult } from "./types.js";
/** Extract case ids from title / fullTitle / tags: C412, TC-412, KIWI:412, [C412]. */
export declare function extractCaseIds(t: Pick<TestResult, "title" | "fullTitle" | "tags">): number[];
