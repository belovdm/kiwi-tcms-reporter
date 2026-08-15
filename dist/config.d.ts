import type { KiwiClientConfig } from "@kiwi-tcms-ai/kiwi-tcms-client";
import type { KiwiSyncOptions } from "./types.js";
export declare function configFromEnv(overrides?: Pick<KiwiSyncOptions, "url" | "username" | "password" | "project">): KiwiClientConfig;
export declare function applyInsecureTls(): void;
export declare function coerceBoolean(v: unknown): boolean | undefined;
export declare function coerceNumber(v: unknown): number | undefined;
