/**
 * A schedule knows its next run as soon as it is written.
 *
 * `next_run_at` used to be left null on create (and nulled on a cron edit) for
 * the scheduler's next tick to fill, so a new schedule showed no next run
 * until that tick and a reload. These drive the real write path against a
 * migrated Postgres.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization, uniq } from "../../__tests__/postgres-seed";
import { nextCronFire } from "../../lib/cron";
import { createScheduleRecord, updateScheduleRecord } from "../schedule-crud";

let organizationId: OrganizationId;

beforeAll(async () => {
  organizationId = await seedOrganization("sched-next-run");
});

function create(cron: string) {
  return createScheduleRecord({
    organizationId,
    name: `sched-${uniq()}`,
    sources: [],
    cron,
    destinationIds: [],
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
    // Off, so another file's scheduler tick on this shared database never
    // picks these up; arming does not depend on it.
    enabled: false,
    maxRetries: 0,
    verifyAfterBackup: false,
    overdueAfterHours: null,
  });
}

/** The cron's next fire after `from`, as the scheduler computes it. */
function fireAfter(cron: string, from: Date): number | undefined {
  const next = nextCronFire(cron, from);
  return next.isOk() ? next.value?.getTime() : undefined;
}

describe("backup_schedule.next_run_at", () => {
  it("is armed when the schedule is created", async () => {
    const before = new Date();
    const row = await create("0 3 * * *");
    expect(row.nextRunAt?.getTime()).toBe(fireAfter("0 3 * * *", before));
  });

  it("follows a cron edit at once, and stays put on any other edit", async () => {
    const row = await create("0 3 * * *");
    const before = new Date();
    const retimed = await updateScheduleRecord({ organizationId, id: row.id, cron: "30 * * * *" });
    expect(retimed?.nextRunAt?.getTime()).toBe(fireAfter("30 * * * *", before));

    const renamed = await updateScheduleRecord({ organizationId, id: row.id, name: "renamed" });
    expect(renamed?.nextRunAt?.getTime()).toBe(retimed?.nextRunAt?.getTime());
  });
});
