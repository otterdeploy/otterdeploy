/**
 * Handlers for `project.manifest.*`.
 *
 * Phase 3 ships read/write (`get`, `save`) and stub responses for `diff`
 * and `apply`. The reconciler that makes `apply` real lands in Phase 4,
 * at which point the diff handler can reuse the same diff routine.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@otterstack/db";
import { project } from "@otterstack/db/schema";
import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import {
  type Manifest,
  manifestSchema,
  resolveEnvironment,
} from "../../stack/manifest";

type ProjectId = Id<typeof ID_PREFIX.project>;
type OrgId = Id<typeof ID_PREFIX.organization>;

export interface ProjectScope {
  projectId: ProjectId;
  organizationId: OrgId;
}

/** Load the manifest column + version, or null when never saved. */
export async function loadManifest(
  scope: ProjectScope,
): Promise<{ manifest: Manifest | null; version: number } | null> {
  const [row] = await db
    .select({
      manifest: project.manifest,
      version: project.manifestVersion,
    })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);

  if (!row) return null;
  return {
    manifest: row.manifest ? (manifestSchema.parse(row.manifest) as Manifest) : null,
    version: row.version,
  };
}

export type SaveOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "conflict"; currentVersion: number };

/** Optimistic-locked write — bump only when expectedVersion matches. */
export async function saveManifest(
  scope: ProjectScope,
  input: { manifest: Manifest; expectedVersion: number },
): Promise<SaveOutcome> {
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
    return { ok: true, version: updated[0]!.version };
  }

  const [current] = await db
    .select({ version: project.manifestVersion })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);
  if (!current) return { ok: false, reason: "not-found" };
  return { ok: false, reason: "conflict", currentVersion: current.version };
}

/** Resolved manifest for a given environment (or base if none). */
export async function resolvedManifest(
  scope: ProjectScope,
  environment?: string,
): Promise<Manifest | null> {
  const row = await loadManifest(scope);
  if (!row?.manifest) return null;
  return resolveEnvironment(row.manifest, environment);
}
