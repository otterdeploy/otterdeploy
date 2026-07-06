/**
 * Disposal sweeper for ephemeral database credentials. `VALID UNTIL` already
 * blocks new logins the moment a credential expires; this finishes the job on
 * a 60s tick — terminates lingering sessions, drops the role, stamps
 * `revokedAt`. Failures (e.g. container down) are logged and retried on the
 * next tick, never thrown.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseEphemeralCredential, project, resource } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, eq, isNull, lt } from "drizzle-orm";
import { log } from "evlog";

import { dropRole, getTarget } from "./internals";

const SWEEP_INTERVAL_MS = 60_000;

export async function sweepExpiredEphemeralCredentials(): Promise<void> {
  const expired = await db
    .select({
      id: databaseEphemeralCredential.id,
      roleName: databaseEphemeralCredential.roleName,
      resourceId: databaseEphemeralCredential.resourceId,
      organizationId: project.organizationId,
    })
    .from(databaseEphemeralCredential)
    .innerJoin(resource, eq(resource.id, databaseEphemeralCredential.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        isNull(databaseEphemeralCredential.revokedAt),
        lt(databaseEphemeralCredential.expiresAt, new Date()),
      ),
    );

  for (const cred of expired) {
    const disposed = await Result.tryPromise({
      try: async () => {
        const target = await getTarget({
          organizationId: cred.organizationId as OrganizationId,
          resourceId: cred.resourceId,
        });
        // Resource deleted out from under the credential → the role died with
        // the database; just close the row.
        if (target) await dropRole(target, cred.roleName);
        await db
          .update(databaseEphemeralCredential)
          .set({ revokedAt: new Date() })
          .where(eq(databaseEphemeralCredential.id, cred.id));
      },
      catch: (cause) => cause,
    });
    if (disposed.isErr()) {
      log.warn({
        ephemeralDb: { step: "sweep", credentialId: cred.id, role: cred.roleName },
        err: disposed.error,
      });
    } else {
      log.info({ ephemeralDb: { step: "sweep-disposed", credentialId: cred.id } });
    }
  }
}

/** Start the disposal sweeper; returns a stop handle (same shape as the
 *  metrics sampler / host-health monitor). */
export function startEphemeralDbSweeper(intervalMs = SWEEP_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    void sweepExpiredEphemeralCredentials().catch((err: unknown) => {
      log.warn({ ephemeralDb: { step: "sweep-tick" }, err });
    });
  }, intervalMs);
  timer.unref();
  const kickoff = setTimeout(() => void sweepExpiredEphemeralCredentials().catch(() => {}), 15_000);
  kickoff.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
