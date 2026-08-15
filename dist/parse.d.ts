import type { FrameworkStatus, TestResult } from "./types.js";
/** Minimal JUnit XML parser — enough for CI reports. */
export declare function parseJunit(xml: string): TestResult[];
export declare function normalizeStatus(s: string | undefined): FrameworkStatus;
export declare function parseResultsJson(raw: string): TestResult[];
