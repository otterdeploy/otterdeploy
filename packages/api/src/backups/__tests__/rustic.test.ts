/**
 * Pure parts of the rustic CLI wrapper: the HKDF password derivation and the
 * `forget` argv builder. The spawn/profile plumbing is smoke-tested against the
 * real binary out of band (see the T2 smoke test), not here.
 */
import { describe, expect, it } from "vite-plus/test";

import { buildForgetArgs, deriveRepoPassword } from "../rustic";

describe("deriveRepoPassword", () => {
  it("is deterministic for a given secret + repoId", () => {
    const a = deriveRepoPassword("auth-secret", "otterdeploy-backups/res_1");
    const b = deriveRepoPassword("auth-secret", "otterdeploy-backups/res_1");
    expect(a).toBe(b);
  });

  it("emits 64 hex chars (32 bytes)", () => {
    expect(deriveRepoPassword("auth-secret", "r")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs per repoId (domain-separated)", () => {
    expect(deriveRepoPassword("auth-secret", "res_1")).not.toBe(
      deriveRepoPassword("auth-secret", "res_2"),
    );
  });

  it("differs per secret", () => {
    expect(deriveRepoPassword("secret-a", "res_1")).not.toBe(
      deriveRepoPassword("secret-b", "res_1"),
    );
  });
});

describe("buildForgetArgs", () => {
  it("scopes by tags, emits only set tiers, prunes, and asks for json", () => {
    expect(
      buildForgetArgs({ keepDaily: 7, keepWeekly: 4, keepWithinDays: 30 }, [
        "otterdeploy",
        "schedule:sch_1",
      ]),
    ).toEqual([
      "forget",
      "--filter-tags",
      "otterdeploy,schedule:sch_1",
      "--keep-daily",
      "7",
      "--keep-weekly",
      "4",
      "--keep-within",
      "30d",
      "--prune",
      "--json",
    ]);
  });

  it("omits zero/undefined tiers and a null keep-within", () => {
    expect(
      buildForgetArgs({ keepLast: 3, keepDaily: 0, keepMonthly: undefined, keepWithinDays: null }, [
        "otterdeploy",
      ]),
    ).toEqual(["forget", "--filter-tags", "otterdeploy", "--keep-last", "3", "--prune", "--json"]);
  });

  it("always prunes even with no tiers set", () => {
    expect(buildForgetArgs({}, ["otterdeploy"])).toEqual([
      "forget",
      "--filter-tags",
      "otterdeploy",
      "--prune",
      "--json",
    ]);
  });
});
