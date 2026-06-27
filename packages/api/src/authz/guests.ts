/**
 * Guest allow-list for protected deployments. Persistent list of invited
 * external emails per route; the OTP flow checks it and reads each guest's
 * session length. Emails are stored normalized (lowercased/trimmed).
 */

import type { DeploymentGuestId, ProxyRouteId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deploymentGuest } from "@otterdeploy/db/schema/deployment-guest";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { and, asc, eq } from "drizzle-orm";

export interface GuestRecord {
  id: DeploymentGuestId;
  email: string;
  sessionHours: number;
  createdAt: Date;
}

const norm = (email: string) => email.trim().toLowerCase();

export async function listGuests(proxyRouteId: ProxyRouteId): Promise<GuestRecord[]> {
  return db
    .select({
      id: deploymentGuest.id,
      email: deploymentGuest.email,
      sessionHours: deploymentGuest.sessionHours,
      createdAt: deploymentGuest.createdAt,
    })
    .from(deploymentGuest)
    .where(eq(deploymentGuest.proxyRouteId, proxyRouteId))
    .orderBy(asc(deploymentGuest.createdAt));
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
  return row!;
}

export async function removeGuest(
  proxyRouteId: ProxyRouteId,
  id: DeploymentGuestId,
): Promise<void> {
  await db
    .delete(deploymentGuest)
    .where(and(eq(deploymentGuest.id, id), eq(deploymentGuest.proxyRouteId, proxyRouteId)));
}

/**
 * Wall-level check: is `email` an invited guest of the deployment on `domain`,
 * and if so for how long (hours)? Returns null when not invited — callers must
 * treat null and "invited" identically to the user (anti-enumeration).
 */
export async function guestSessionHoursFor(domain: string, email: string): Promise<number | null> {
  const [row] = await db
    .select({ hours: deploymentGuest.sessionHours })
    .from(deploymentGuest)
    .innerJoin(proxyRoute, eq(proxyRoute.id, deploymentGuest.proxyRouteId))
    .where(and(eq(proxyRoute.domain, domain), eq(deploymentGuest.email, norm(email))))
    .limit(1);
  return row?.hours ?? null;
}
