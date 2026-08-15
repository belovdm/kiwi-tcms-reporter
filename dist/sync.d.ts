import type { KiwiSyncOptions, SyncClient, SyncReport, TestResult } from "./types.js";
export type { SyncClient, SyncEntry, SyncReport } from "./types.js";
export declare class KiwiSync {
    private client;
    private statusMap;
    private projectIdCache;
    constructor(client: SyncClient);
    sync(results: TestResult[], opts: KiwiSyncOptions): Promise<SyncReport>;
    private resolveRun;
    private findBuild;
    private createBuild;
    private currentUserId;
    private projectId;
    private findCase;
    private caseScope;
    private createCase;
    private ensureExecution;
    private applyResult;
    private statusId;
    private buildStatusMap;
}
export declare function runSync(results: TestResult[], rawOptions: KiwiSyncOptions): Promise<void>;
export declare function printReport(r: SyncReport): string;
