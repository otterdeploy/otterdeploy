import { describe, expect, it } from "vite-plus/test";

import {
  isMainEnvironment,
  resolveDefaultEnvironment,
  sortEnvironments,
} from "@/features/shell/environment-default";

/**
 * The regression these guard is "adding an environment made it the main one".
 * The cause was an unordered `[0]` fallback, so the assertions that matter are
 * the ones about ORDER INDEPENDENCE: the same set in a different sequence must
 * resolve to the same environment.
 */

const env = (id: string, slug: string, createdAt: string) => ({ id, slug, createdAt });

const PROD = env("env_1", "production", "2026-01-01T00:00:00Z");
const STAGING = env("env_2", "staging", "2026-02-01T00:00:00Z");
const DEV = env("env_3", "development", "2026-03-01T00:00:00Z");

describe("resolveDefaultEnvironment", () => {
  it("prefers the project's pointer over the production convention", () => {
    // A project whose main environment is deliberately staging must open there.
    expect(resolveDefaultEnvironment([PROD, STAGING, DEV], "env_2")).toBe(STAGING);
  });

  it("does not change answer when the list order changes", () => {
    // The actual bug: a collection yields rows in no guaranteed order, and a
    // newly inserted row can land anywhere in it.
    const forward = resolveDefaultEnvironment([PROD, STAGING, DEV], null);
    const reversed = resolveDefaultEnvironment([DEV, STAGING, PROD], null);
    const newestFirst = resolveDefaultEnvironment([DEV, PROD, STAGING], null);
    expect(forward).toBe(PROD);
    expect(reversed).toBe(PROD);
    expect(newestFirst).toBe(PROD);
  });

  it("adding an environment never changes the answer", () => {
    const before = resolveDefaultEnvironment([PROD, STAGING], "env_1");
    // The new row arrives at the FRONT: the position that used to win.
    const after = resolveDefaultEnvironment([DEV, PROD, STAGING], "env_1");
    expect(after).toBe(before);
  });

  it("falls back to slug production when the project has no pointer", () => {
    expect(resolveDefaultEnvironment([DEV, PROD, STAGING], null)).toBe(PROD);
    expect(resolveDefaultEnvironment([DEV, PROD, STAGING], undefined)).toBe(PROD);
  });

  it("treats a dangling pointer as absent rather than blanking the switcher", () => {
    // The main environment was deleted; degrade to the convention.
    expect(resolveDefaultEnvironment([PROD, STAGING], "env_deleted")).toBe(PROD);
  });

  it("falls back to the oldest environment when nothing is slugged production", () => {
    const a = env("env_a", "qa", "2026-05-01T00:00:00Z");
    const b = env("env_b", "canary", "2026-04-01T00:00:00Z");
    expect(resolveDefaultEnvironment([a, b], null)).toBe(b);
    expect(resolveDefaultEnvironment([b, a], null)).toBe(b);
  });

  it("breaks a createdAt tie on slug so the answer is still deterministic", () => {
    const same = "2026-04-01T00:00:00Z";
    const zeta = env("env_z", "zeta", same);
    const alpha = env("env_a", "alpha", same);
    expect(resolveDefaultEnvironment([zeta, alpha], null)).toBe(alpha);
    expect(resolveDefaultEnvironment([alpha, zeta], null)).toBe(alpha);
  });

  it("survives a malformed timestamp without going non-deterministic", () => {
    const broken = env("env_x", "broken", "not-a-date");
    const good = env("env_y", "good", "2026-06-01T00:00:00Z");
    expect(resolveDefaultEnvironment([broken, good], null)).toBe(good);
    expect(resolveDefaultEnvironment([good, broken], null)).toBe(good);
  });

  it("returns undefined for a project with no environments", () => {
    expect(resolveDefaultEnvironment([], "env_1")).toBeUndefined();
    expect(resolveDefaultEnvironment([], null)).toBeUndefined();
  });

  it("accepts a Date as well as an ISO string", () => {
    // The optimistic row inserted by the create dialog carries a real Date.
    const optimistic = { id: "env_new", slug: "qa", createdAt: new Date("2026-01-15T00:00:00Z") };
    expect(resolveDefaultEnvironment([STAGING, optimistic], null)).toBe(optimistic);
  });
});

describe("sortEnvironments", () => {
  it("orders oldest first and does not mutate its input", () => {
    const input = [DEV, PROD, STAGING];
    const sorted = sortEnvironments(input);
    expect(sorted.map((e) => e.slug)).toEqual(["production", "staging", "development"]);
    expect(input.map((e) => e.slug)).toEqual(["development", "production", "staging"]);
  });
});

describe("isMainEnvironment", () => {
  it("keys on the id, not the slug", () => {
    // "Production" slugged `prod`, and a project whose main is staging on
    // purpose, both have to badge correctly.
    const prod = env("env_9", "prod", "2026-01-01T00:00:00Z");
    expect(isMainEnvironment(prod, "env_9")).toBe(true);
    expect(isMainEnvironment(PROD, "env_9")).toBe(false);
  });

  it("is false when the project has no pointer", () => {
    expect(isMainEnvironment(PROD, null)).toBe(false);
    expect(isMainEnvironment(PROD, undefined)).toBe(false);
  });
});
