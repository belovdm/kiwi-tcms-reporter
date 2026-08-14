import { afterEach, describe, expect, it } from "vitest";
import { configFromEnv } from "../src/config.js";

const KEYS = ["KIWI_URL", "KIWI_TOKEN", "KIWI_PROJECT", "KIWI_INSECURE", "KIWI_TIMEOUT"] as const;

describe("configFromEnv", () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
      delete prev[key];
    }
  });

  function setEnv(vars: Record<string, string>) {
    for (const [key, value] of Object.entries(vars)) {
      prev[key] = process.env[key];
      process.env[key] = value;
    }
  }

  it("reads url, token, project and strips a trailing slash", () => {
    setEnv({
      KIWI_URL: "https://kiwi.example/",
      KIWI_TOKEN: "tok",
      KIWI_PROJECT: "Payments",
    });
    expect(configFromEnv()).toEqual({
      url: "https://kiwi.example",
      token: "tok",
      project: "Payments",
      timeoutMs: 30_000,
    });
  });

  it("throws when url or token is missing", () => {
    setEnv({ KIWI_URL: "", KIWI_TOKEN: "" });
    expect(() => configFromEnv()).toThrow(/KIWI_URL/);
  });

  it("lets reporter options override env", () => {
    setEnv({ KIWI_URL: "https://env.example", KIWI_TOKEN: "env-tok" });
    expect(configFromEnv({ url: "https://opt.example", token: "opt-tok", project: "Shop" })).toMatchObject({
      url: "https://opt.example",
      token: "opt-tok",
      project: "Shop",
    });
  });
});
