/**
 * A resource's instances when otterd runs it: one per grant (a slot's
 * generation on a node), newest first, with the attempt's container as the
 * node last reported it. The same `ResourceInstance` shape the Swarm and
 * plain-Docker listings produce, so the instances, deployments and log views
 * read otterd services unchanged. Null when otterd does not run the name.
 */
import { db } from "@otterdeploy/db";
import { otterdGrant, otterdService, otterdServiceRevision } from "@otterdeploy/db/schema/otterd";
import { resource } from "@otterdeploy/db/schema/project";
import { serviceSpec } from "@otterdeploy/otterd-proto";
import { idSchema } from "@otterdeploy/shared/id";
import { Temporal } from "@otterdeploy/shared/temporal";
import { desc, eq } from "drizzle-orm";

import type { ResourceInstance } from "./resource-instances";

/** Recent history kept in the list: live grants and the ones just before them. */
const HISTORY = 20;

type GrantRow = typeof otterdGrant.$inferSelect;

const iso = (ms: number | null) =>
  ms === null ? null : Temporal.Instant.fromEpochMilliseconds(ms).toString();

/** The grant as the backend states the views already understand. */
function stateOf(g: GrantRow): string {
  if (g.state === "released") return g.failed ? "failed" : "shutdown";
  if (g.failed) return "failed";
  if (g.revokedAt !== null) return "shutdown";
  if (g.state === "running") return g.runningSince === null ? "paused" : "running";
  return "starting";
}

async function runsOnOtterd(resourceId: string): Promise<boolean> {
  const id = idSchema.resource.safeParse(resourceId);
  if (!id.success) return true;
  const [row] = await db
    .select({ owner: resource.runtimeOwner })
    .from(resource)
    .where(eq(resource.id, id.data));
  return !row || row.owner === "otterd";
}

async function deploymentIds(resourceId: string): Promise<Map<number, string>> {
  const revs = await db
    .select({ revision: otterdServiceRevision.revision, spec: otterdServiceRevision.spec })
    .from(otterdServiceRevision)
    .where(eq(otterdServiceRevision.resourceId, resourceId));
  return new Map(
    revs.flatMap((r) => {
      const spec = serviceSpec.safeParse(r.spec);
      const id = spec.success
        ? spec.data.task.container.labels?.["otterdeploy.deployment.id"]
        : null;
      return id ? [[r.revision, id]] : [];
    }),
  );
}

export async function otterdInstances(serviceName: string): Promise<ResourceInstance[] | null> {
  const [svc] = await db
    .select({ resourceId: otterdService.resourceId })
    .from(otterdService)
    .where(eq(otterdService.serviceName, serviceName));
  if (!svc || !(await runsOnOtterd(svc.resourceId))) return null;
  const grants = await db
    .select()
    .from(otterdGrant)
    .where(eq(otterdGrant.resourceId, svc.resourceId))
    .orderBy(desc(otterdGrant.createdAt))
    .limit(HISTORY);
  const deployments = await deploymentIds(svc.resourceId);
  return grants.map((g) => {
    const state = stateOf(g);
    return {
      id: g.grantId,
      containerId: g.container,
      state,
      message: `generation ${g.generation} on ${g.nodeId}`,
      err: g.failed ? "the attempt failed; see its logs" : null,
      exitCode: null,
      createdAt: iso(g.createdAt),
      updatedAt: iso(g.releasedAt ?? g.runningSince ?? g.sentAt ?? g.createdAt),
      deploymentId: deployments.get(g.specRevision) ?? null,
      slot: g.slotIndex,
      nodeId: g.nodeId,
      desiredState: g.revokedAt === null && g.state !== "released" ? "running" : "shutdown",
      restartCount: Math.max(g.attempts.length - 1, 0),
      oomKilled: null,
    };
  });
}
