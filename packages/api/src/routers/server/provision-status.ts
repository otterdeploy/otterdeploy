/**
 * The provision job's own moves along pending → provisioning → joining →
 * ready | failed, and the stalled-provision reaper's exit for a job whose
 * worker died. Each is a guarded transition: it only moves a row that is
 * still where its writer expects it and returns undefined otherwise, which
 * means the writer was superseded (a duplicated or redelivered
 * `server.provision` job, a row the reaper failed, a deleted server), not
 * that the write failed. A redelivered job against a joined node therefore
 * does nothing, and can never mark a working node failed.
 */
import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { and, eq, inArray, lt } from "drizzle-orm";
import { log } from "evlog";

import { publishOrgEvent } from "../project/project-event-bus";
import { type ServerRecord } from "./queries";

type OrgId = OrganizationId;

type ProvisionDetails = Pick<
  Partial<typeof server.$inferInsert>,
  "provisionError" | "hostname" | "daemonVersion" | "meshAddress"
>;

/** pending → provisioning: the job's claim on the row. */
export async function claimServerProvision(
  serverId: ServerId,
  organizationId: OrgId,
): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ provisionStatus: "provisioning", provisionError: null })
    .where(
      and(
        eq(server.id, serverId),
        eq(server.organizationId, organizationId),
        eq(server.provisionStatus, "pending"),
      ),
    )
    .returning();
  if (row) publishOrgEvent(organizationId, "servers");
  return row;
}

/** provisioning → joining: the remote steps ran, the node is joining. */
export async function markServerJoining(
  serverId: ServerId,
  organizationId: OrgId,
  details: ProvisionDetails,
): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ ...details, provisionStatus: "joining" })
    .where(
      and(
        eq(server.id, serverId),
        eq(server.organizationId, organizationId),
        eq(server.provisionStatus, "provisioning"),
      ),
    )
    .returning();
  if (row) publishOrgEvent(organizationId, "servers");
  return row;
}

/** joining → ready, and the node's status down → ready (a status someone
 *  else set, e.g. draining, is theirs to keep). */
export async function markServerProvisioned(
  serverId: ServerId,
  organizationId: OrgId,
  details: ProvisionDetails,
): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ ...details, provisionStatus: "ready", provisionError: null })
    .where(
      and(
        eq(server.id, serverId),
        eq(server.organizationId, organizationId),
        eq(server.provisionStatus, "joining"),
      ),
    )
    .returning();
  if (!row) return undefined;
  const [up] = await db
    .update(server)
    .set({ status: "ready" })
    .where(and(eq(server.id, serverId), eq(server.status, "down")))
    .returning();
  publishOrgEvent(organizationId, "servers");
  return up ?? row;
}

/** provisioning/joining → failed. Leaves `status` alone: the node never
 *  joined (still `down` from the insert), and a status anyone else set is not
 *  this job's to take back. */
export async function markServerProvisionFailed(
  serverId: ServerId,
  organizationId: OrgId,
  provisionError: string,
): Promise<ServerRecord | undefined> {
  const [row] = await db
    .update(server)
    .set({ provisionStatus: "failed", provisionError })
    .where(
      and(
        eq(server.id, serverId),
        eq(server.organizationId, organizationId),
        inArray(server.provisionStatus, ["provisioning", "joining"]),
      ),
    )
    .returning();
  if (row) publishOrgEvent(organizationId, "servers");
  return row;
}

/**
 * How long a row may sit in `provisioning`/`joining` with no write before the
 * reaper decides its job is dead. The `server.provision` job runs once
 * (attempts=1, the operator retries explicitly), so a worker that dies mid-run
 * leaves the row in flight with nothing else that will ever move it, and
 * retryProvision only accepts `failed`. The longest quiet stretch of a live
 * job is the Docker install over SSH on a slow box (package mirrors, an image
 * pull), minutes; half an hour is past any of that and still short enough that
 * the operator is not left staring at a spinner all afternoon.
 */
export const PROVISION_STALL_MS = 30 * 60_000;

/** How often the reaper looks. A stalled row is noticed within one interval
 *  of crossing PROVISION_STALL_MS. */
const PROVISION_REAPER_INTERVAL_MS = 5 * 60_000;

const STALLED_PROVISION_MESSAGE =
  "Provisioning stopped making progress (the worker running it likely died or restarted). Retry to run it again.";

/**
 * Fail every row stuck in `provisioning`/`joining` whose last write is older
 * than `stallMs`: provisioning/joining → failed, so retryProvision can take it
 * again. A job that was merely slow and is still alive finds its next guarded
 * step refused and stops. Returns the reaped rows.
 */
export async function reapStalledProvisions(
  stallMs = PROVISION_STALL_MS,
): Promise<Array<{ id: ServerId; organizationId: string }>> {
  // A Date only at the drizzle timestamp seam.
  const cutoff = new Date(
    Temporal.Now.instant().subtract({ milliseconds: stallMs }).epochMilliseconds,
  );
  const reaped = await db
    .update(server)
    .set({ provisionStatus: "failed", provisionError: STALLED_PROVISION_MESSAGE })
    .where(
      and(
        inArray(server.provisionStatus, ["provisioning", "joining"]),
        lt(server.updatedAt, cutoff),
      ),
    )
    .returning({ id: server.id, organizationId: server.organizationId });
  for (const organizationId of new Set(reaped.map((row) => row.organizationId)))
    publishOrgEvent(organizationId, "servers");
  return reaped;
}

/** Run reapStalledProvisions on an interval. Returns a stop handle. */
export function startProvisionReaper(intervalMs = PROVISION_REAPER_INTERVAL_MS): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const reaped = await Result.tryPromise({
      try: () => reapStalledProvisions(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    running = false;
    if (reaped.isErr()) {
      log.warn({ provision: { event: "reaper-failed" }, error: reaped.error.message });
    } else if (reaped.value.length > 0) {
      log.warn({ provision: { event: "stalled-reaped", count: reaped.value.length } });
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
