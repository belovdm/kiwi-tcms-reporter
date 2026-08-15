import type { KiwiSyncOptions } from "./types.js";
export declare class KiwiJestReporter {
    private options;
    constructor(_globalConfig: unknown, options?: KiwiSyncOptions);
    onRunComplete(_contexts: unknown, results: {
        testResults?: unknown[];
    } | undefined): Promise<void>;
}
export declare class KiwiPlaywrightReporter {
    private options;
    private collected;
    constructor(options?: KiwiSyncOptions);
    onTestEnd(test: {
        title?: string;
        titlePath?: () => string[];
        location?: {
            file?: string;
        };
        tags?: string[];
    }, result: {
        status?: string;
        duration?: number;
        error?: {
            message?: string;
            stack?: string;
        };
        errors?: Array<{
            message?: string;
            stack?: string;
        }>;
    }): void;
    onEnd(_result: unknown): Promise<void>;
}
interface MochaRunnerLike {
    on(event: string, cb: (...args: unknown[]) => void): void;
}
export declare function kiwiMochaReporter(this: {
    done?: (failures: number, fn: (failures: number) => void) => void;
}, runner: MochaRunnerLike, options?: {
    reporterOptions?: KiwiSyncOptions;
}): void;
export {};
