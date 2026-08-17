/**
 * Pure decision surfaces added by the production-hardening pass: cron
 * validation, retry backoff, overdue thresholds,
 * restore-verification verdicts, per-engine restore commands, the probe repo
 * key, and the keyring-fallback password-error matcher.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { OverdueCandidate } from "../schedule-db";

import { cronIntervalMs, nextCronFire, validateCron } from "../../lib/cron";
import { deriveProbeRepoKey } from "../backends";
import { engineDataDir, restoreCommand } from "../engine-helpers";
import { isOverdue, overdueThresholdMs } from "../overdue";
import { buildForgetArgs, isPasswordError } from "../rustic";
import { retryBackoffMs } from "../scheduler";
import { verificationSupport, verificationVerdict } from "../verify-restore";

const HOUR = 3_600_000;

// Real branded ids (minted, not cast: assertions are banned repo-wide).
const SCHEDULE_ID = createId(ID_PREFIX.backupSchedule);
const ORG_ID = createId(ID_PREFIX.organization);

describe("cron", () => {
  it("accepts standard 5-field expressions and nicknames", () => {
    expect(validateCron("*/15 * * * *").isOk()).toBe(true);
    expect(validateCron("0 4 * * MON-FRI").isOk()).toBe(true);
    expect(validateCron("@daily").isOk()).toBe(true);
  });

  it("rejects malformed expressions with a field-level reason", () => {
    const bad = validateCron("99 * * * *");
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) expect(bad.error.message).toMatch(/range|field/i);
    expect(validateCron("not a cron").isErr()).toBe(true);
    expect(validateCron("* * * * * *").isErr()).toBe(true);
  });

  it("computes the next fire strictly from the reference date", () => {
    const from = new Date("2030-01-01T00:00:00Z");
    const next = nextCronFire("0 4 * * *", from);
    expect(next.isOk() && next.value?.toISOString()).toBe("2030-01-01T04:00:00.000Z");
  });

  it("derives the cadence interval", () => {
    expect(cronIntervalMs("0 * * * *", new Date("2030-01-01T00:30:00Z"))).toBe(HOUR);
    expect(cronIntervalMs("garbage", new Date())).toBeNull();
  });
});

describe("retryBackoffMs", () => {
  it("doubles from 5s and caps at 30s", () => {
    expect(retryBackoffMs(1)).toBe(5_000);
    expect(retryBackoffMs(2)).toBe(10_000);
    expect(retryBackoffMs(3)).toBe(20_000);
    expect(retryBackoffMs(4)).toBe(30_000);
    expect(retryBackoffMs(8)).toBe(30_000);
  });
});

describe("overdue policy", () => {
  const base: OverdueCandidate = {
    id: SCHEDULE_ID,
    organizationId: ORG_ID,
    name: "nightly",
    cron: "0 4 * * *",
    overdueAfterHours: null,
    overdueNotifiedAt: null,
    createdAt: new Date("2030-01-01T00:00:00Z"),
    lastSuccessAt: null,
  };
  const now = new Date("2030-01-03T00:00:00Z");

  it("uses the explicit threshold when set", () => {
    expect(overdueThresholdMs({ cron: "0 4 * * *", overdueAfterHours: 6 }, now)).toBe(6 * HOUR);
  });

  it("derives 2x the cron cadence when unset (daily → 48h)", () => {
    expect(overdueThresholdMs({ cron: "0 4 * * *", overdueAfterHours: null }, now)).toBe(48 * HOUR);
  });

  it("falls back to 24h for an unparseable cron", () => {
    expect(overdueThresholdMs({ cron: "nope", overdueAfterHours: null }, now)).toBe(24 * HOUR);
  });

  it("flags a schedule with no success past the threshold", () => {
    // Created 48h ago, daily cadence → exactly at the 2x boundary, not past it.
    expect(isOverdue(base, now)).toBe(false);
    expect(isOverdue(base, new Date("2030-01-03T00:00:01Z"))).toBe(true);
  });

  it("measures from the newest success when one exists", () => {
    const fresh = { ...base, lastSuccessAt: new Date("2030-01-02T23:00:00Z") };
    expect(isOverdue(fresh, now)).toBe(false);
  });

  it("dedupes: an already-notified episode does not re-flag", () => {
    const notified = { ...base, overdueNotifiedAt: new Date("2030-01-02T00:00:00Z") };
    expect(isOverdue(notified, new Date("2030-01-05T00:00:00Z"))).toBe(false);
  });
});

describe("verificationVerdict", () => {
  it("passes a clean restore with tables and a sane size ratio", () => {
    expect(verificationVerdict({ restoreExitCode: 0, tableCount: 12, sizeRatio: 1.4 }).passed).toBe(
      true,
    );
  });

  it("fails on a non-zero restore exit", () => {
    const v = verificationVerdict({ restoreExitCode: 1, tableCount: 12, sizeRatio: 1.4 });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/exited 1/);
  });

  it("fails an empty restored database", () => {
    expect(verificationVerdict({ restoreExitCode: 0, tableCount: 0, sizeRatio: null }).passed).toBe(
      false,
    );
  });

  it("fails an implausibly small restore (databasus's 20% floor)", () => {
    const v = verificationVerdict({ restoreExitCode: 0, tableCount: 3, sizeRatio: 0.1 });
    expect(v.passed).toBe(false);
    expect(v.reason).toMatch(/implausibly small/);
  });

  it("tolerates an unknown ratio (no dump size recorded)", () => {
    expect(verificationVerdict({ restoreExitCode: 0, tableCount: 3, sizeRatio: null }).passed).toBe(
      true,
    );
  });
});

describe("verificationSupport", () => {
  const dbCtx = { kind: "database", engine: "postgres", storagePath: "abc" } as const;
  it("supports succeeded postgres runs", () => {
    expect(verificationSupport({ ...dbCtx }).ok).toBe(true);
  });
  it("rejects volume runs, non-postgres engines, and snapshot-less runs", () => {
    expect(verificationSupport({ kind: "volume" }).ok).toBe(false);
    expect(verificationSupport({ ...dbCtx, engine: "mariadb" }).ok).toBe(false);
    expect(verificationSupport({ ...dbCtx, storagePath: null }).ok).toBe(false);
  });
});

describe("restoreCommand", () => {
  const creds = { databaseName: "app", username: "u", password: "p" };
  it("postgres uses pg_restore with clean/if-exists", () => {
    const r = restoreCommand({ engine: "postgres", ...creds });
    expect(r.cmd[0]).toBe("pg_restore");
    expect(r.cmd).toContain("--if-exists");
    expect(r.env).toEqual(["PGPASSWORD=p"]);
  });
  it("mariadb replays SQL through the mysql client with a quoted db", () => {
    const r = restoreCommand({ engine: "mariadb", ...creds });
    expect(r.cmd[2]).toContain("mysql -u 'u' 'app'");
    expect(r.env).toEqual(["MYSQL_PWD=p"]);
  });
  it("mongodb uses mongorestore --archive --drop scoped to the db", () => {
    const r = restoreCommand({ engine: "mongodb", ...creds });
    expect(r.cmd).toContain("--drop");
    expect(r.cmd).toContain("--nsInclude=app.*");
  });
  it("redis throws toward the volume path", () => {
    expect(() => restoreCommand({ engine: "redis", ...creds })).toThrow(/volume/);
  });
});

describe("engineDataDir", () => {
  it("maps engines to their data mounts", () => {
    expect(engineDataDir("postgres")).toBe("/var/lib/postgresql/data");
    expect(engineDataDir("mariadb")).toBe("/var/lib/mysql");
    expect(engineDataDir("mongodb")).toBe("/data/db");
  });
});

describe("buildForgetArgs (new tiers)", () => {
  it("emits keep-last and keep-hourly flags when set", () => {
    const args = buildForgetArgs({ keepLast: 2, keepHourly: 6, keepDaily: 7 }, ["otterdeploy"]);
    expect(args).toContain("--keep-last");
    expect(args).toContain("--keep-hourly");
    expect(args.join(" ")).toContain("--keep-hourly 6");
  });
});

describe("isPasswordError", () => {
  it("matches rustic wrong-password shapes only", () => {
    expect(isPasswordError("error: incorrect password for repository")).toBe(true);
    expect(isPasswordError("no suitable key found!")).toBe(true);
    expect(isPasswordError("connection refused")).toBe(false);
    expect(isPasswordError("bucket does not exist")).toBe(false);
  });
});

describe("deriveProbeRepoKey", () => {
  it("reserves the volume-.probe scope under the destination prefix", () => {
    const key = deriveProbeRepoKey("org_1", { config: { prefix: "team" }, managed: false });
    expect(key.repoId).toBe("team/otterdeploy-backups/volume-.probe");
    expect(key.passwordDomain).toBe(key.repoId);
  });
  it("org-qualifies the managed destination's password domain", () => {
    const key = deriveProbeRepoKey("org_1", { config: {}, managed: true });
    expect(key.repoId).toBe("volume-.probe");
    expect(key.passwordDomain).toBe("org_1/volume-.probe");
  });
});
