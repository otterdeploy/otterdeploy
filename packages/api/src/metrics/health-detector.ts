import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema";
/**
 * Service health-transition detector — emits `health.degraded` /
 * `health.recovered` when a managed service's container health flips. Fed from
 * the metrics sampler tick (it already lists running managed containers); we
 * derive a coarse health from each container's Docker healthcheck status and
 * compare it to the previous observation held in an in-memory map keyed by
 * resourceId.
 *
 * In-memory by design (NO schema): a control-plane restart resets the map, which
 * at worst re-emits one transition event the next time a flip is observed —
 * acceptable for a best-effort notification.
 *
 * Limitation: only services that DEFINE a Docker healthcheck produce a
 * healthy/unhealthy signal. A service with no healthcheck — or a fully crashed /
 * unscheduled container that drops out of the running list — is "no signal" and
 * won't transition here; catching absent replicas needs desired-vs-actual
 * reconciliation, which is out of scope.
 */
import { eq } from "drizzle-orm";
import { log } from "evlog";

import { emitPlatformEvent } from "../notifications/emit";

type Health = "healthy" | "unhealthy";

/** Last-observed health per resource. Reset on restart (see file header). */
const lastHealth = new Map<string, Health>();

/**
 * Coarse health from a Docker list entry's `Status` string ("Up 2h (healthy)").
 * Returns null when there's no healthcheck marker — we don't transition on a
 * plain running container (no signal) to avoid false degraded/recovered noise.
 */
export function healthFromStatus(status: string | undefined): Health | null {
  if (!status) return null;
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(healthy)")) return "healthy";
  return null;
}

/**
 * Record this tick's observed health per resource and emit on a transition.
 * Best-effort: never throws (so it can't break the sampler), each emit is
 * independently guarded.
 */
export async function recordHealthObservations(
  observed: Array<{ resourceId: ResourceId; health: Health }>,
): Promise<void> {
  for (const { resourceId, health } of observed) {
    const prev = lastHealth.get(resourceId);
    lastHealth.set(resourceId, health);
    if (!prev || prev === health) continue;
    await emitHealthEvent(resourceId, health).catch((cause) => {
      log.warn({
        health: { event: "emit-failed", resourceId },
        error: cause instanceof Error ? cause.message : String(cause),
      } as Record<string, unknown>);
    });
  }
}

async function emitHealthEvent(resourceId: ResourceId, health: Health): Promise<void> {
  const [info] = await db
    .select({
      organizationId: project.organizationId,
      resourceName: resource.name,
      projectName: project.name,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(resource.id, resourceId))
    .limit(1);
  if (!info?.organizationId) return;

  const degraded = health === "unhealthy";
  await emitPlatformEvent({
    organizationId: info.organizationId as OrganizationId,
    eventId: degraded ? "health.degraded" : "health.recovered",
    title: degraded ? "Service health degraded" : "Service recovered",
    message: degraded
      ? `${info.resourceName} is reporting unhealthy`
      : `${info.resourceName} is healthy again`,
    data: { resource: info.resourceName, project: info.projectName, health },
  });
}
