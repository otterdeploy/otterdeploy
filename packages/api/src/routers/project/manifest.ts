/**
 * Handlers for `project.manifest.*`.
 *
 * Phase 3 ships read/write (`get`, `save`) and stub responses for `diff`
 * and `apply`. The reconciler that makes `apply` real lands in Phase 4,
 * at which point the diff handler can reuse the same diff routine.
 */

import { and, eq, sql } from "drizzle-orm";
import { Result } from "better-result";

import { db } from "@otterstack/db";
import { project } from "@otterstack/db/schema";
import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import {
  type Manifest,
  manifestSchema,
  resolveEnvironment,
} from "../../stack/manifest";
import { ManifestVersionConflictError, ProjectNotFoundError } from "./errors";

type ProjectId = Id<typeof ID_PREFIX.project>;
type OrgId = Id<typeof ID_PREFIX.organization>;

export interface ProjectScope {
  projectId: ProjectId;
  organizationId: OrgId;
}

/** Load the manifest column + version, or null when never saved. */
export async function loadManifest(
  scope: ProjectScope,
): Promise<Result<{ manifest: Manifest | null; version: number }, ProjectNotFoundError>> {
  const [row] = await db
    .select({
      manifest: project.manifest,
      version: project.manifestVersion,
    })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);

  if (!row) return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  return Result.ok({
    manifest: row.manifest ? (manifestSchema.parse(row.manifest) as Manifest) : null,
    version: row.version,
  });
}

/** Optimistic-locked write — bump only when expectedVersion matches. */
export async function saveManifest(
  scope: ProjectScope,
  input: { manifest: Manifest; expectedVersion: number },
): Promise<Result<{ version: number }, ProjectNotFoundError | ManifestVersionConflictError>> {
  const updated = await db
    .update(project)
    .set({
      manifest: input.manifest,
      manifestVersion: sql`${project.manifestVersion} + 1`,
    })
    .where(
      and(
        eq(project.id, scope.projectId),
        eq(project.organizationId, scope.organizationId),
        eq(project.manifestVersion, input.expectedVersion),
      ),
    )
    .returning({ version: project.manifestVersion });

  if (updated.length > 0) {
    return Result.ok({ version: updated[0]!.version });
  }

  const [current] = await db
    .select({ version: project.manifestVersion })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);
  if (!current) {
    return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  }
  return Result.err(new ManifestVersionConflictError({ currentVersion: current.version }));
}

/**
 * Discard pending manifest changes — revert to the last successfully
 * applied snapshot. `lastAppliedManifest` is updated by applyManifest
 * on every successful reconcile; this just copies it back into
 * `manifest`, bumping the version counter so concurrent CLI/UI sessions
 * see a fresh state.
 *
 * If the project has never been applied, the manifest is cleared (null).
 */
export async function discardManifest(
  scope: ProjectScope,
): Promise<Result<{ version: number }, ProjectNotFoundError>> {
  const [row] = await db
    .select({ lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);
  if (!row) return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));

  const updated = await db
    .update(project)
    .set({
      manifest: row.lastApplied ?? null,
      manifestVersion: sql`${project.manifestVersion} + 1`,
    })
    .where(
      and(
        eq(project.id, scope.projectId),
        eq(project.organizationId, scope.organizationId),
      ),
    )
    .returning({ version: project.manifestVersion });

  if (updated.length === 0) {
    return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  }
  return Result.ok({ version: updated[0]!.version });
}

/** Resolved manifest for a given environment (or base if none). */
export async function resolvedManifest(
  scope: ProjectScope,
  environment?: string,
): Promise<Result<Manifest | null, ProjectNotFoundError>> {
  const row = await loadManifest(scope);
  if (row.isErr()) return Result.err(row.error);
  if (!row.value.manifest) return Result.ok(null);
  return Result.ok(resolveEnvironment(row.value.manifest, environment));
}
