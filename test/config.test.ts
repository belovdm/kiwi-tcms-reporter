import { afterEach, describe, expect, it } from "vitest";
import { configFromEnv } from "../src/config.js";

const KEYS = [
  "KIWI_URL",
  "KIWI_USERNAME",
  "KIWI_PASSWORD",
  "KIWI_PROJECT",
  "KIWI_INSECURE",
  "KIWI_TIMEOUT",
] as const;

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

  it("reads url, username, password, project and strips a trailing slash", () => {
    setEnv({
      KIWI_URL: "https://kiwi.example/",
      KIWI_USERNAME: "admin",
      KIWI_PASSWORD: "secret",
      KIWI_PROJECT: "Payments",
    });
    expect(configFromEnv()).toEqual({
      url: "https://kiwi.example",
      username: "admin",
      password: "secret",
      project: "Payments",
      timeoutMs: 30_000,
    });
  });

  it("throws when url or credentials are missing", () => {
    setEnv({ KIWI_URL: "", KIWI_USERNAME: "", KIWI_PASSWORD: "" });
    expect(() => configFromEnv()).toThrow(/KIWI_URL/);
  });

  it("lets reporter options override env", () => {
    setEnv({
      KIWI_URL: "https://env.example",
      KIWI_USERNAME: "env-user",
      KIWI_PASSWORD: "env-pass",
    });
    expect(
      configFromEnv({
        url: "https://opt.example",
        username: "opt-user",
        password: "opt-pass",
        project: "Shop",
      }),
    ).toMatchObject({
      url: "https://opt.example",
      username: "opt-user",
      password: "opt-pass",
      project: "Shop",
    });
  });
});
