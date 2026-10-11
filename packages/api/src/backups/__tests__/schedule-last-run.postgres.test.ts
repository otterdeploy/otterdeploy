/**
 * A schedule's `last_run_status` reports the last pass that RAN.
 *
 * Arming a schedule (creating it, or editing its cron) used to stamp `queued`
 * over whatever the last pass reported, so a schedule could read "queued"
 * with nothing queued. Arming sets only `next_run_at`, and a pass that
 * finishes after a newer one has reported never overwrites it.
 *
 * The dump itself is stood in for (`executeBackup` settles the run as the
 * test says); everything else is the real scheduler against a migrated
 * Postgres. The scheduler's events need Redis, so this file runs only with
 * INTEGRATION_REDIS_URL.
 */
import type {
  BackupDestinationId,
  BackupId,
  BackupScheduleId,
  OrganizationId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupSchedule } from "@otterdeploy/db/schema";
import { closeQueues } from "@otterdeploy/jobs";
import { Temporal } from "@otterdeploy/shared/temporal";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { seedDatabase, seedOrganization, seedProject, uniq } from "../../__tests__/postgres-seed";
import { createDestinationRecord } from "../../routers/backups/destination-queries";
import { createBackupRun, markBackupFailed, markBackupRunning, markBackupSucceeded } from "../db";
import { createScheduleRecord, updateScheduleRecord } from "../schedule-crud";
import { executeSchedulePass, runDueBackupSchedules } from "../scheduler";

const { redisUrl, dump } = vi.hoisted(() => {
  /* oxlint-disable node/no-process-env -- test env boundary: no Docker daemon here, and the scheduler's events need the opt-in integration Redis */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-schedule-last-run.sock";
  const url = process.env.INTEGRATION_REDIS_URL;
  if (url) process.env.REDIS_URL = url;
  /* oxlint-enable node/no-process-env */
  return { redisUrl: url, dump: { outcome: "succeeded" } };
});

vi.mock("../engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine")>();
  return {
    ...actual,
    executeBackup: async (backupId: BackupId) => {
      await markBackupRunning(backupId);
      if (dump.outcome === "succeeded")
        await markBackupSucceeded(backupId, {
          storagePath: `snap-${backupId}`,
          checksum: null,
          compressedSizeBytes: 1,
          durationMs: 1,
          method: "pg_dump",
        });
      else await markBackupFailed(backupId, "dump exited 1");
    },
  };
});

let organizationId: OrganizationId;
let sourceId: ResourceId;
let destinationId: BackupDestinationId;
const createdSchedules: BackupScheduleId[] = [];

/** Far enough ahead that every schedule this file armed is due. The scheduler
 *  takes a Date at its boundary. */
let clock = Temporal.Now.instant().add({ hours: 24 });
function tick(): Date {
  clock = clock.add({ hours: 1 });
  return new Date(clock.epochMilliseconds);
}

beforeAll(async () => {
  if (!redisUrl) return;
  organizationId = await seedOrganization("sched-last-run");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const database = await seedDatabase({
    projectId,
    environmentId: mainEnvironmentId,
    name: "pg",
    tag: "sched",
  });
  sourceId = database.resourceId;
  const destination = await createDestinationRecord({
    organizationId,
    name: `local-${uniq()}`,
    type: "local",
    config: { path: `/nonexistent/otterdeploy-schedule-last-run/${uniq()}` },
    encryptedSecret: null,
    usedForBackups: true,
  });
  destinationId = destination.id;
});

afterAll(async () => {
  await closeQueues();
});

async function readSchedule(id: BackupScheduleId) {
  const [row] = await db
    .select({
      lastRunStatus: backupSchedule.lastRunStatus,
      lastRunAt: backupSchedule.lastRunAt,
      nextRunAt: backupSchedule.nextRunAt,
    })
    .from(backupSchedule)
    .where(eq(backupSchedule.id, id));
  if (!row) throw new Error(`no schedule ${id}`);
  return row;
}

/** A schedule only the next tick runs: every earlier one is switched off.
 *  Creating it arms it; the tick clock is far enough ahead that it is due. */
async function createArmedSchedule(): Promise<BackupScheduleId> {
  for (const id of createdSchedules)
    await db.update(backupSchedule).set({ enabled: false }).where(eq(backupSchedule.id, id));
  const row = await createScheduleRecord({
    organizationId,
    name: `sched-${uniq()}`,
    sources: [sourceId],
    cron: "0 * * * *",
    destinationIds: [destinationId],
    keepLast: 3,
    keepHourly: 0,
    keepDaily: 0,
    keepWeekly: 0,
    keepMonthly: 0,
    keepYearly: 0,
    retentionDays: null,
    maxStorageGb: null,
    preHook: null,
    encryption: "none",
    enabled: true,
    maxRetries: 0,
    verifyAfterBackup: false,
    overdueAfterHours: null,
  });
  createdSchedules.push(row.id);
  return row.id;
}

describe.skipIf(!redisUrl)("backup_schedule.last_run_status", () => {
  it("a new schedule is armed without a backfill run and reports no pass", async () => {
    const id = await createArmedSchedule();
    // A tick before its first fire time runs nothing.
    await runDueBackupSchedules(new Date());
    const armed = await readSchedule(id);
    expect(armed.lastRunStatus).toBeNull();
    expect(armed.lastRunAt).toBeNull();
    expect(armed.nextRunAt).not.toBeNull();
  });

  it("a due tick reports its pass, and re-arming after a cron edit leaves that report", async () => {
    const id = await createArmedSchedule();
    dump.outcome = "failed";
    await runDueBackupSchedules(tick());
    const ran = await readSchedule(id);
    expect(ran.lastRunStatus).toBe("failed");
    expect(ran.lastRunAt).not.toBeNull();

    await updateScheduleRecord({ organizationId, id, cron: "30 * * * *" });
    const rearmed = await readSchedule(id);
    expect(rearmed.nextRunAt?.getUTCMinutes()).toBe(30);
    expect(rearmed.lastRunStatus).toBe("failed");
  });

  it("a pass that finishes after a newer one has reported does not overwrite it", async () => {
    const id = await createArmedSchedule();
    const run = async (outcome: "succeeded" | "failed") => {
      dump.outcome = outcome;
      return createBackupRun({
        organizationId,
        source: { kind: "database", resourceId: sourceId },
        destinationId,
        scheduleId: id,
        method: "manual-schedule",
      });
    };
    const newer = Temporal.Now.instant();
    await executeSchedulePass(id, [await run("failed")], newer);
    expect((await readSchedule(id)).lastRunStatus).toBe("failed");
    // Started before `newer`, finished after it.
    await executeSchedulePass(id, [await run("succeeded")], newer.subtract({ minutes: 5 }));
    expect((await readSchedule(id)).lastRunStatus).toBe("failed");
    await executeSchedulePass(id, [await run("succeeded")], newer.add({ minutes: 5 }));
    expect((await readSchedule(id)).lastRunStatus).toBe("succeeded");
  });
});
