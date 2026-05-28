/**
 * Project-scoped env var CRUD.
 *
 * Rows in `projectEnvVar` back the magic `${{project.X}}` and
 * `${{environment.X}}` references the variable resolver expands at
 * deploy time. Storage is keyed by (projectId, environmentId, key) so
 * the same KEY can carry different values across environments — each
 * row IS a per-environment value.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import { projectEnvVar } from "@otterdeploy/db/schema/project";
import { type Id, ID_PREFIX } from "@otterdeploy/shared/id";

import type { ProjectId } from "../errors";

type EnvironmentId = Id<typeof ID_PREFIX.environment>;

export interface ProjectEnvVarRow {
  id: Id<typeof ID_PREFIX.projectEnvVar>;
  projectId: ProjectId;
  environmentId: EnvironmentId;
  key: string;
  value: string;
  isSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Scope {
  projectId: ProjectId;
  environmentId: EnvironmentId;
}

/**
 * List every env var attached to a (project, environment), key-ordered.
 * Used by the UI's Shared variables tab and by the resolver's
 * `loadProjectEnvBag` (which then flattens to Record<string,string>).
 */
export async function listProjectEnvVars(scope: Scope): Promise<ProjectEnvVarRow[]> {
  const rows = await db
    .select()
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, scope.projectId),
        eq(projectEnvVar.environmentId, scope.environmentId),
      ),
    )
    .orderBy(asc(projectEnvVar.key));
  return rows as ProjectEnvVarRow[];
}

/**
 * Upsert one key. The unique index on (projectId, environmentId, key)
 * is the natural conflict target — re-setting an existing key is a
 * value replacement, not an error.
 */
export async function upsertProjectEnvVar(input: {
  scope: Scope;
  key: string;
  value: string;
  isSecret?: boolean;
}): Promise<ProjectEnvVarRow> {
  const [row] = await db
    .insert(projectEnvVar)
    .values({
      projectId: input.scope.projectId,
      environmentId: input.scope.environmentId,
      key: input.key,
      value: input.value,
      isSecret: input.isSecret ?? true,
    })
    .onConflictDoUpdate({
      target: [projectEnvVar.projectId, projectEnvVar.environmentId, projectEnvVar.key],
      set: {
        value: input.value,
        isSecret: input.isSecret ?? true,
      },
    })
    .returning();
  if (!row) throw new Error("projectEnvVar upsert returned no row");
  return row as ProjectEnvVarRow;
}

/** Drop one key from the (project, environment) bag. No-op when the key
 *  doesn't exist — keeps idempotent client behaviour. */
export async function deleteProjectEnvVar(input: {
  scope: Scope;
  key: string;
}): Promise<void> {
  await db
    .delete(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.projectId, input.scope.projectId),
        eq(projectEnvVar.environmentId, input.scope.environmentId),
        eq(projectEnvVar.key, input.key),
      ),
    );
}

/**
 * Replace the whole (project, environment) bag in one transaction. The
 * Shared variables tab uses this as its Save action — the editor sends
 * the full desired state; rows not in `next` are dropped, others are
 * upserted. Atomic so the resolver never sees a partially-applied set
 * during a deploy.
 */
export async function bulkReplaceProjectEnvVars(
  scope: Scope,
  next: ReadonlyArray<{ key: string; value: string; isSecret?: boolean }>,
): Promise<ProjectEnvVarRow[]> {
  return db.transaction(async (tx) => {
    await tx
      .delete(projectEnvVar)
      .where(
        and(
          eq(projectEnvVar.projectId, scope.projectId),
          eq(projectEnvVar.environmentId, scope.environmentId),
        ),
      );
    if (next.length === 0) return [];
    const rows = await tx
      .insert(projectEnvVar)
      .values(
        next.map((v) => ({
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          key: v.key,
          value: v.value,
          isSecret: v.isSecret ?? true,
        })),
      )
      .returning();
    return rows as ProjectEnvVarRow[];
  });
}
