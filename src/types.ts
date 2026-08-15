export type FrameworkStatus =
  "passed" | "failed" | "skipped" | "pending" | "todo" | "timedOut" | "interrupted";

export interface TestResult {
  title: string;
  fullTitle?: string;
  file?: string;
  status: FrameworkStatus;
  durationMs?: number;
  error?: string;
  tags?: string[];
}

export interface KiwiSyncOptions {
  run?: number;
  plan?: number;
  build?: string;
  runSummary?: string;
  matchBy?: "auto" | "tag" | "title";
  createMissing?: boolean;
  commentFailures?: boolean;
  dryRun?: boolean;
  closeRun?: boolean;
  limitErrorLength?: number;
  url?: string;
  username?: string;
  password?: string;
  project?: string;
}

export interface SyncEntry {
  test: string;
  frameworkStatus: FrameworkStatus;
  kiwiStatus: string;
  caseId?: number;
  caseSummary?: string;
  executionId?: number;
  ok: boolean;
  note?: string;
}

export interface SyncReport {
  runId: number;
  runUrl: string;
  total: number;
  matched: number;
  updated: number;
  createdCases: number;
  failedOps: number;
  unmatched: string[];
  byKiwiStatus: Record<string, number>;
  entries: SyncEntry[];
  dryRun: boolean;
  closed: boolean;
  closeRequested: boolean;
}

export interface SyncClient {
  endpoint: string;
  call<T = unknown>(method: string, params?: unknown[] | Record<string, unknown>): Promise<T>;
  projectProductId(): Promise<number>;
}
