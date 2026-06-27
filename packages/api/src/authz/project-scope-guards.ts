import type {
  BackupId,
  BackupScheduleId,
  EnvironmentId,
  OrganizationId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { ORPCError } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { backup, backupSchedule } from "@otterdeploy/db/schema/backup";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
/**
 * DB-backed API-key project-scope enforcers.
 *
 * These wrap the pure `requireProjectScope` (authz/api-key-scope.ts) with the
 * one lookup needed to resolve a project id from whatever id a procedure
 * actually carries (resource / backup / env / schedule), then throw FORBIDDEN
 * when a `projectScope: "selected"` key is acting outside its allow-list.
 *
 * Every enforcer is a strict no-op for non-key actors (session/cookie/CLI
 * bearer) and for keys whose scope isn't `"selected"` — it returns BEFORE
 * touching the database. Resolution misses (id not found in the active org) also
 * return early: the handler's own NOT_FOUND is the right error there, not a
 * FORBIDDEN that would leak which ids exist.
 *
 * The `projectScopedProcedure` middleware (index.ts) already covers every
 * procedure whose validated input carries `projectId` directly; these guards
 * are for the id-keyed procedures where the project must be derived first.
 */
import { and, eq } from "drizzle-orm";

import type { Context } from "../context";

import { requireProjectScope } from "./api-key-scope";

/** The handful of `db` methods these guards touch — narrowed so tests can pass
 *  a hand-rolled mock without the full drizzle type surface. Mirrors the
 *  reconcile.ts (packages/jobs) injection pattern. */
type DbLike = Pick<typeof db, "select">;

const FORBIDDEN = () =>
  new ORPCError("FORBIDDEN", {
    message: "This API key is not scoped to that project.",
  });

/** True when there's nothing to enforce: a non-key actor, or a key that isn't
 *  restricted to specific projects. Lets callers skip the DB lookup entirely. */
function scopeIrrelevant(context: Context): boolean {
  return !context.apiKey || context.apiKey.projectScope !== "selected";
}

/** Active org id, narrowed to non-null. Guards only run inside org-scoped
 *  procedures (orgScopedMiddleware already threw NO_ACTIVE_ORGANIZATION
 *  otherwise), so this is sound. */
function orgId(context: Context): OrganizationId {
  return context.activeOrganizationId as OrganizationId;
}

/**
 * Enforce the key's project scope against a known project id. No-ops for
 * non-selected keys and for a falsy `projectId` (the org check is the only
 * gate we can apply when the project can't be determined — e.g. an org-level
 * environment with a null projectId).
 */
export function enforceProjectScope(context: Context, projectId: string | null | undefined): void {
  if (scopeIrrelevant(context)) return;
  if (!projectId) return;
  if (!requireProjectScope(context.apiKey, projectId)) throw FORBIDDEN();
}

/**
 * Resolve `resource.projectId` and enforce. The `resource` table has no org
 * column — org scoping is through `project.organizationId` via inner join,
 * exactly like the project router's own resource queries. A miss (wrong org or
 * unknown id) returns early so the handler's own NOT_FOUND fires.
 */
export async function enforceResourceScope(
  context: Context,
  resourceId: ResourceId,
  client: DbLike = db,
): Promise<void> {
  if (scopeIrrelevant(context)) return;
  const [row] = await client
    .select({ projectId: resource.projectId })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(and(eq(resource.id, resourceId), eq(project.organizationId, orgId(context))))
    .limit(1);
  if (!row) return;
  enforceProjectScope(context, row.projectId);
}

/**
 * Resolve a backup → its resource → that resource's project and enforce. The
 * backup row carries its own org column, so we gate on it directly; the project
 * id comes from the joined resource. A miss returns early.
 */
export async function enforceBackupScope(
  context: Context,
  backupId: BackupId,
  client: DbLike = db,
): Promise<void> {
  if (scopeIrrelevant(context)) return;
  const [row] = await client
    .select({ projectId: resource.projectId })
    .from(backup)
    .innerJoin(resource, eq(resource.id, backup.resourceId))
    .where(and(eq(backup.id, backupId), eq(backup.organizationId, orgId(context))))
    .limit(1);
  if (!row) return;
  enforceProjectScope(context, row.projectId);
}

/**
 * Resolve `backupSchedule.projectId` (scoped to the active org) and enforce.
 * An org-wide schedule has a null projectId ⇒ enforceProjectScope no-ops,
 * which is correct. A miss returns early.
 */
export async function enforceScheduleScope(
  context: Context,
  scheduleId: BackupScheduleId,
  client: DbLike = db,
): Promise<void> {
  if (scopeIrrelevant(context)) return;
  const [row] = await client
    .select({ projectId: backupSchedule.projectId })
    .from(backupSchedule)
    .where(
      and(eq(backupSchedule.id, scheduleId), eq(backupSchedule.organizationId, orgId(context))),
    )
    .limit(1);
  if (!row) return;
  enforceProjectScope(context, row.projectId);
}

/**
 * Resolve `environment.projectId` and enforce. The `environment` table has no
 * org column — org scoping is through `project.organizationId` via inner join,
 * exactly like the env router's own `getEnvInOrg`. A standalone (unclaimed) env
 * has a null projectId and no project to join, so it never matches here and the
 * guard no-ops — the handler's NOT_FOUND is the right error for that. A miss
 * returns early.
 */
export async function enforceEnvScope(
  context: Context,
  envId: EnvironmentId,
  client: DbLike = db,
): Promise<void> {
  if (scopeIrrelevant(context)) return;
  const [row] = await client
    .select({ projectId: environment.projectId })
    .from(environment)
    .innerJoin(project, eq(project.id, environment.projectId))
    .where(and(eq(environment.id, envId), eq(project.organizationId, orgId(context))))
    .limit(1);
  if (!row) return;
  enforceProjectScope(context, row.projectId);
}
