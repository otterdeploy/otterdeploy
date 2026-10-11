/**
 * Rotate a managed database's password.
 *
 * Order matters, because there are three copies of the credential that must
 * agree: the engine, the database row, and every service that connects with
 * it.
 *
 *   1. One transaction, with the database row locked FOR UPDATE: rewrite the
 *      variables that hold the old password verbatim (./rotate-password-env),
 *      write the new password and connection strings to the row, then change
 *      the password ON THE ENGINE. A refused statement throws, which rolls the
 *      row and the variables back, so a failed rotation changes nothing. If
 *      the engine took the change but the commit then fails, the engine is
 *      put back to the old password (best effort, logged).
 *   2. Roll every service that depends on the database, in its environment:
 *      the ones whose `${{db.*}}` references resolve from the row, and the ones
 *      whose stored values were rewritten. Each roll re-resolves env from the
 *      committed row, so it comes up with the new password.
 *   3. Postgres only, unless asked not to: end the sessions that opened before
 *      the change. `ALTER ROLE` leaves an open session alone, so this is what
 *      makes the rotation a revocation for a leaked password.
 *
 * A dependent that fails to roll does not undo the rotation (the old password
 * no longer exists anywhere to roll back to); it is reported per service.
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import type { HostRow } from "../../../database-hosting";
import type { ProjectRef } from "../../scopes";
import type { DatabaseResourceRecord } from "../queries";

import { getHostRow } from "../../../database-hosting";
import { findTransitiveDependents } from "../../../lib/variables";
import { postgresEndSessionsStatement } from "../../../swarm/database-engines/password-rotation";
import { redeployOne } from "../../service/redeploy";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "../errors";
import { publishResourceChanged } from "../project-event-bus";
import { getDatabaseResourceRecord, getProjectInOrg } from "../queries";
import {
  adminTarget,
  commitRotation,
  runOnEngine,
  type CommittedRotation,
} from "./rotate-password-commit";
import {
  PasswordRotationFailedError,
  PasswordRotationUnsupportedError,
  rotationTarget,
} from "./rotate-password-errors";

export interface RotatedDependent {
  resourceId: ResourceId;
  name: string;
  /** The service's runtime status after its roll, or `error`. */
  status: string;
  error: string | null;
}

export interface PasswordRotationResult {
  resourceId: ResourceId;
  engine: string;
  rotatedAt: string;
  /** Every service that was rolled onto the new password, in roll order. */
  dependents: RotatedDependent[];
  /** Stored variables that held the old password verbatim and now hold the
   *  new one. */
  rewrittenVariables: number;
  /** Sessions ended because they authenticated with the old password; null
   *  when not attempted (engine other than postgres, or opted out). */
  terminatedSessions: number | null;
}

type RotationError =
  | ProjectNotFoundError
  | PostgresResourceNotFoundError
  | PasswordRotationUnsupportedError
  | PasswordRotationFailedError;

export async function rotateDatabasePassword(
  input: ProjectRef & { resourceId: ResourceId; terminateSessions: boolean },
  log: RequestLogger,
): Promise<Result<PasswordRotationResult, RotationError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
  if (!record) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }
  const engine = rotationTarget(record);
  if (engine.isErr()) return Result.err(engine.error);

  const hostId = record.database.hostResourceId;
  const host = hostId
    ? await getHostRow({ organizationId: input.organizationId, resourceId: hostId })
    : null;
  if (hostId && !host) {
    return Result.err(
      new PasswordRotationFailedError({
        resourceId: input.resourceId,
        reason: "the database server this database lives on was not found",
      }),
    );
  }

  const nextPassword = randomBytes(18).toString("base64url");
  const committed = await commitRotation(
    {
      record,
      engine: engine.value,
      host,
      projectSlug: project.slug,
      mainEnvironmentId: project.environmentId,
    },
    nextPassword,
    log,
  );
  if (committed.isErr()) return Result.err(committed.error);
  const rotatedAt = Temporal.Now.instant().toString();
  await publishResourceChanged(record.resource.id);

  const dependents = await rollDependents(record, committed.value, project, log);
  const terminatedSessions =
    input.terminateSessions && record.database.engine === "postgres"
      ? await endOldSessions(record, host, project.slug, nextPassword, committed.value, log)
      : null;

  log.set({
    passwordRotation: {
      engine: record.database.engine,
      dependents: dependents.map((d) => ({ name: d.name, status: d.status })),
      rewrittenVariables: committed.value.rewrite.rewritten,
      terminatedSessions,
    },
  });

  return Result.ok({
    resourceId: record.resource.id,
    engine: record.database.engine,
    rotatedAt,
    dependents,
    rewrittenVariables: committed.value.rewrite.rewritten,
    terminatedSessions,
  });
}

/**
 * The services to roll, in order. Reference dependents are kept only inside
 * the database's own environment: every environment reuses the base names, so
 * staging's `${{db.URL}}` is staging's db, not this one. A service
 * whose stored value held THIS password verbatim rolls wherever it lives.
 * Drafts never deployed are skipped: rolling one would be its first deploy.
 */
async function dependentsToRoll(
  record: DatabaseResourceRecord,
  committed: CommittedRotation,
  mainEnvironmentId: string | null,
): Promise<Array<{ id: ResourceId; name: string }>> {
  const viaRefs = await findTransitiveDependents({
    projectId: record.resource.projectId,
    targetResourceId: record.resource.id,
    targetResourceName: record.resource.name,
  });
  const literal = new Set([...committed.rewrite.services, ...committed.rewrite.subscribers]);
  const ordered = [...new Set([...viaRefs, ...literal])];
  if (ordered.length === 0) return [];

  const rows = await db
    .select({
      id: resource.id,
      name: resource.name,
      status: resource.status,
      environmentId: resource.environmentId,
      previewId: resource.previewId,
    })
    .from(resource)
    .where(inArray(resource.id, ordered));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const home = record.resource.environmentId ?? mainEnvironmentId;

  const out: Array<{ id: ResourceId; name: string }> = [];
  for (const id of ordered) {
    const row = byId.get(id);
    if (!row || row.previewId !== null || row.status === "draft") continue;
    const sameEnvironment = (row.environmentId ?? mainEnvironmentId) === home;
    if (!literal.has(id) && !sameEnvironment) continue;
    out.push({ id, name: row.name });
  }
  return out;
}

async function rollDependents(
  record: DatabaseResourceRecord,
  committed: CommittedRotation,
  project: { slug: string; environmentId: string | null },
  log: RequestLogger,
): Promise<RotatedDependent[]> {
  const targets = await dependentsToRoll(record, committed, project.environmentId);
  const rolled: RotatedDependent[] = [];
  for (const target of targets) {
    const result = await Result.tryPromise({
      try: () => redeployOne(record.resource.projectId, target.id, project.slug, log),
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    });
    // A roll that threw, a roll the resolver refused, and a roll that ran:
    // each is one row, so the caller sees every dependent exactly once.
    const base = { resourceId: target.id, name: target.name };
    if (result.isErr()) rolled.push({ ...base, status: "error", error: result.error });
    else if (result.value.isErr()) {
      rolled.push({ ...base, status: "error", error: result.value.error.message });
    } else {
      const runtime = result.value.value;
      rolled.push({ ...base, status: runtime.status, error: runtime.errorMessage ?? null });
    }
  }
  return rolled;
}

/** Postgres: end the role's sessions that predate the change. Best effort: a
 *  failure here is logged and reported as null, the rotation itself stands. */
async function endOldSessions(
  record: DatabaseResourceRecord,
  host: HostRow | null,
  projectSlug: string,
  nextPassword: string,
  committed: CommittedRotation,
  log: RequestLogger,
): Promise<number | null> {
  if (!committed.cutoff) return null;
  const target = adminTarget(record, host, projectSlug, {
    username: record.database.username,
    password: nextPassword,
    databaseName: record.database.databaseName,
  });
  const ended = await runOnEngine(target, [
    postgresEndSessionsStatement(record.database.username, committed.cutoff),
  ]);
  if (ended.isErr()) {
    log.set({ passwordRotationSessions: { ok: false, error: ended.error } });
    return null;
  }
  const count = Number.parseInt(ended.value.trim(), 10);
  return Number.isFinite(count) ? count : null;
}
