import { applyInsecureTls as applyInsecureTlsShared } from "@kiwi-tcms-ai/kiwi-tcms-client";
import type { KiwiClientConfig } from "@kiwi-tcms-ai/kiwi-tcms-client";
import type { KiwiSyncOptions } from "./types.js";

export function configFromEnv(
  overrides: Pick<KiwiSyncOptions, "url" | "username" | "password" | "project"> = {},
): KiwiClientConfig {
  const url = (overrides.url ?? process.env.KIWI_URL ?? "").trim().replace(/\/+$/, "");
  const username = (overrides.username ?? process.env.KIWI_USERNAME ?? "").trim();
  const password = overrides.password ?? process.env.KIWI_PASSWORD ?? "";
  if (!url || !username || !password) {
    throw new Error(
      "KIWI_URL / KIWI_USERNAME / KIWI_PASSWORD are not set. Export them before the run, or pass url/username/password in reporter options.",
    );
  }
  const project = (overrides.project ?? process.env.KIWI_PROJECT ?? "").trim();
  const timeoutRaw = process.env.KIWI_TIMEOUT;
  return {
    url,
    username,
    password,
    project: project || undefined,
    timeoutMs: timeoutRaw ? parseInt(timeoutRaw, 10) : 30_000,
  };
}

export function applyInsecureTls(): void {
  if (process.env.KIWI_INSECURE === "1" || process.env.KIWI_INSECURE === "true") {
    applyInsecureTlsShared();
  }
}

export function coerceNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return undefined;
}
