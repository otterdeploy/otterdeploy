/**
 * Guest allow-list for protected deployments. Persistent list of invited
 * external emails; the OTP flow checks it and reads each guest's session
 * length. Emails are stored normalized (lowercased/trimmed).
 *
 * Rows are keyed by the route they were invited on, but the list is the
 * SERVICE's: protection is per service, so a guest invited from
 * whichever host the settings card showed may sign in on any of its hosts,
 * and the list reads and removes across them all.
 */

import type { DeploymentGuestId, ProxyRouteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentGuest } from "@otterdeploy/db/schema/deployment-guest";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, asc, eq, inArray } from "drizzle-orm";

export interface GuestRecord {
  id: DeploymentGuestId;
  email: string;
  sessionHours: number;
  createdAt: Date;
}

const norm = (email: string) => email.trim().toLowerCase();

/** The guests of a service, given its route ids. One row per email: the same
 *  address invited from two hosts is one guest. */
export async function listGuests(serviceRouteIds: ProxyRouteId[]): Promise<GuestRecord[]> {
  if (serviceRouteIds.length === 0) return [];
  const rows = await db
    .select({
      id: deploymentGuest.id,
      email: deploymentGuest.email,
      sessionHours: deploymentGuest.sessionHours,
      createdAt: deploymentGuest.createdAt,
    })
    .from(deploymentGuest)
    .where(inArray(deploymentGuest.proxyRouteId, serviceRouteIds))
    .orderBy(asc(deploymentGuest.createdAt));
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.email)) return false;
    seen.add(row.email);
    return true;
  });
}

/** Invite (or update the session length of) a guest. Idempotent on
 *  (route, email). */
export async function upsertGuest(input: {
  proxyRouteId: ProxyRouteId;
  email: string;
  sessionHours: number;
  invitedByUserId?: string;
}): Promise<GuestRecord> {
  const email = norm(input.email);
  const [row] = await db
    .insert(deploymentGuest)
    .values({
      proxyRouteId: input.proxyRouteId,
      email,
      sessionHours: input.sessionHours,
      invitedByUserId: input.invitedByUserId ?? null,
    })
    .onConflictDoUpdate({
      target: [deploymentGuest.proxyRouteId, deploymentGuest.email],
      set: { sessionHours: input.sessionHours },
    })
    .returning({
      id: deploymentGuest.id,
      email: deploymentGuest.email,
      sessionHours: deploymentGuest.sessionHours,
      createdAt: deploymentGuest.createdAt,
    });
  if (!row) throw new Error("upsertGuest: insert returned no row");
  return row;
}

/** Remove a guest from the service: the addressed row and the same email
 *  invited on any other host of it, so removing really revokes. */
export async function removeGuest(
  serviceRouteIds: ProxyRouteId[],
  id: DeploymentGuestId,
): Promise<void> {
  if (serviceRouteIds.length === 0) return;
  const [target] = await db
    .select({ email: deploymentGuest.email })
    .from(deploymentGuest)
    .where(and(eq(deploymentGuest.id, id), inArray(deploymentGuest.proxyRouteId, serviceRouteIds)))
    .limit(1);
  if (!target) return;
  await db
    .delete(deploymentGuest)
    .where(
      and(
        eq(deploymentGuest.email, target.email),
        inArray(deploymentGuest.proxyRouteId, serviceRouteIds),
      ),
    );
}

/**
 * Wall-level check: is `email` an invited guest of the deployment on `domain`,
 * and if so for how long (hours)? Returns null when not invited. Callers must
 * treat null and "invited" identically to the user (anti-enumeration).
 */
export async function guestSessionHoursFor(domain: string, email: string): Promise<number | null> {
  const [route] = await db
    .select({ id: proxyRoute.id, resourceId: proxyRoute.resourceId })
    .from(proxyRoute)
    .where(eq(proxyRoute.domain, domain))
    .limit(1);
  if (!route) return null;
  // Any host of the same service (see the module note).
  const service = route.resourceId
    ? db
        .select({ id: proxyRoute.id })
        .from(proxyRoute)
        .where(eq(proxyRoute.resourceId, route.resourceId))
    : null;
  const [row] = await db
    .select({ hours: deploymentGuest.sessionHours })
    .from(deploymentGuest)
    .where(
      and(
        service
          ? inArray(deploymentGuest.proxyRouteId, service)
          : eq(deploymentGuest.proxyRouteId, route.id),
        eq(deploymentGuest.email, norm(email)),
      ),
    )
    .limit(1);
  return row?.hours ?? null;
}
