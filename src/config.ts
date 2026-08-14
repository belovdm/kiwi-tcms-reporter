import type { KiwiClientConfig } from "@kiwi-tcms-ai/kiwi-tcms-client";
import type { KiwiSyncOptions } from "./types.js";

export function configFromEnv(
  overrides: Pick<KiwiSyncOptions, "url" | "token" | "project"> = {},
): KiwiClientConfig {
  const url = (overrides.url ?? process.env.KIWI_URL ?? "").trim().replace(/\/+$/, "");
  const token = (overrides.token ?? process.env.KIWI_TOKEN ?? "").trim();
  if (!url || !token) {
    throw new Error(
      "KIWI_URL / KIWI_TOKEN are not set. Export them before the run, or pass url/token in reporter options.",
    );
  }
  const project = (overrides.project ?? process.env.KIWI_PROJECT ?? "").trim();
  const timeoutRaw = process.env.KIWI_TIMEOUT;
  return {
    url,
    token,
    project: project || undefined,
    timeoutMs: timeoutRaw ? parseInt(timeoutRaw, 10) : 30_000,
  };
}

export function applyInsecureTls(): void {
  if (process.env.KIWI_INSECURE === "1" || process.env.KIWI_INSECURE === "true") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}

export function coerceNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return undefined;
}
