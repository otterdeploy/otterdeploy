/**
 * Handlers for `project.manifest.*`.
 *
 * Phase 3 ships read/write (`get`, `save`) and stub responses for `diff`
 * and `apply`. The reconciler that makes `apply` real lands in Phase 4,
 * at which point the diff handler can reuse the same diff routine.
 */

import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";

import {
  isSecretSentinel,
  manifestSchema,
  parseRefs,
  resolveEnvironment,
  type Manifest,
} from "../../stack/manifest";
import { ManifestVersionConflictError, ProjectNotFoundError } from "./errors";

type OrgId = OrganizationId;

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

  const [updatedRow] = updated;
  if (updatedRow) {
    return Result.ok({ version: updatedRow.version });
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
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .returning({ version: project.manifestVersion });

  const [updatedRow] = updated;
  if (!updatedRow) {
    return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  }
  return Result.ok({ version: updatedRow.version });
}

/**
 * Keep the saved manifest truthful after a live public-toggle on a database.
 *
 * Only patches when the manifest EXPLICITLY declares `publicEnabled` for this
 * database — an omitted key means "live-managed" (the diff skips it, same
 * convention as services), and inventing the key here would promote the field
 * to manifest control the user never asked for. Best-effort: a concurrent
 * manifest save wins the version race and this no-ops; the diff guard on
 * undefined still prevents phantom reverts.
 */
export async function syncManifestDatabasePublic(
  scope: ProjectScope,
  name: string,
  publicEnabled: boolean,
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  const entry = manifest?.databases?.[name];
  if (
    !manifest ||
    !entry ||
    entry.publicEnabled === undefined ||
    entry.publicEnabled === publicEnabled
  ) {
    return;
  }
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      databases: { ...manifest.databases, [name]: { ...entry, publicEnabled } },
    },
    expectedVersion: row.value.version,
  });
}

/** Same back-sync for a declared `extraEnv`: after a live env edit, patch the
 *  saved manifest's declared map to the applied one so the next diff doesn't
 *  stage a phantom revert. No-op when the manifest omits the key (live-managed)
 *  or already matches. */
export async function syncManifestDatabaseExtraEnv(
  scope: ProjectScope,
  name: string,
  extraEnv: Record<string, string>,
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  const entry = manifest?.databases?.[name];
  if (!manifest || !entry || entry.extraEnv === undefined) return;
  const declared = entry.extraEnv;
  const declaredKeys = Object.keys(declared);
  const nextKeys = Object.keys(extraEnv);
  const unchanged =
    declaredKeys.length === nextKeys.length && nextKeys.every((k) => declared[k] === extraEnv[k]);
  if (unchanged) return;
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      databases: { ...manifest.databases, [name]: { ...entry, extraEnv } },
    },
    expectedVersion: row.value.version,
  });
}

/**
 * Service twin of {@link syncManifestDatabaseExtraEnv}: after a LIVE env edit
 * (variables tab, CLI `env set`), patch the manifest's declared env to match
 * the applied rows so the next diff doesn't stage phantom deletes for
 * live-added keys — or worse, resurrect a live-deleted one on Apply.
 *
 * Declared `${secret}` and `${…ref}` values are PRESERVED when their key
 * survives — the rows hold the resolved/live value, and overwriting the
 * declaration would destroy it. No-op when the manifest omits env
 * (live-managed) or already matches. Best-effort on the version race, same as
 * the database sync.
 */
export async function syncManifestServiceEnv(
  scope: ProjectScope,
  name: string,
  applied: Record<string, string>,
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  const entry = manifest?.services?.[name];
  if (!manifest || !entry || entry.env === undefined || Object.keys(entry.env).length === 0) {
    return;
  }
  const declared = entry.env;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(applied)) {
    const declaredValue = declared[key];
    const opaque =
      declaredValue !== undefined &&
      (isSecretSentinel(declaredValue) || parseRefs(declaredValue).length > 0);
    next[key] = opaque ? declaredValue : value;
  }
  const declaredKeys = Object.keys(declared);
  const nextKeys = Object.keys(next);
  const unchanged =
    declaredKeys.length === nextKeys.length && nextKeys.every((k) => declared[k] === next[k]);
  if (unchanged) return;
  await saveManifest(scope, {
    manifest: { ...manifest, services: { ...manifest.services, [name]: { ...entry, env: next } } },
    expectedVersion: row.value.version,
  });
}

/**
 * Mirror a live compose-content edit (compose.updateContent) into the desired
 * manifest so the manifest stays the source of truth. Inline stacks only — a
 * git stack's file lives in its repo, not the manifest. Without this, a later
 * manifest apply/DR restore would re-materialize the OLD YAML and silently
 * revert the operator's edit. Best-effort + optimistic-locked via saveManifest.
 */
export async function syncManifestComposeContent(
  scope: ProjectScope,
  name: string,
  content: string,
  files?: Array<{ path: string; content: string }>,
): Promise<void> {
  const row = await loadManifest(scope);
  if (row.isErr()) return;
  const manifest = row.value.manifest;
  const entry = manifest?.composes?.[name];
  if (!manifest || !entry || entry.source !== "inline") return;
  if (entry.content === content && files === undefined) return;
  await saveManifest(scope, {
    manifest: {
      ...manifest,
      composes: {
        ...manifest.composes,
        [name]: { ...entry, content, ...(files ? { files } : {}) },
      },
    },
    expectedVersion: row.value.version,
  });
}

/**
 * Drop a resource from BOTH the desired manifest and the last-applied snapshot.
 * Called when a resource is deleted directly. Without this, `manifest.<coll>[name]`
 * survives the delete, so the next diff sees it declared-but-absent and re-stages
 * a phantom `create` — the "pending create" ghost that reappears after a deployed
 * resource is deleted. A deployed resource must NEVER revert to pending-create.
 * Best-effort, no optimistic lock: a delete is terminal (low contention); we bump
 * the version so live UI/CLI sessions refresh.
 */
async function removeFromManifest(
  scope: ProjectScope,
  collection: "services" | "databases" | "composes",
  name: string,
): Promise<void> {
  const [row] = await db
    .select({ manifest: project.manifest, lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);
  if (!row) return;

  const strip = (m: Record<string, unknown> | null): Record<string, unknown> | null => {
    const coll = (m as Record<string, Record<string, unknown> | undefined> | null)?.[collection];
    if (!m || !coll || !(name in coll)) return m;
    const rest = { ...coll };
    delete rest[name];
    return { ...m, [collection]: rest };
  };

  const nextManifest = strip(row.manifest);
  const nextApplied = strip(row.lastApplied);
  // Nothing referenced this resource — leave the version untouched.
  if (nextManifest === row.manifest && nextApplied === row.lastApplied) return;

  await db
    .update(project)
    .set({
      manifest: nextManifest,
      lastAppliedManifest: nextApplied,
      manifestVersion: sql`${project.manifestVersion} + 1`,
    })
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)));
}

/** Drop a compose stack from the manifest on delete (compose.delete). */
export function removeComposeFromManifest(scope: ProjectScope, name: string): Promise<void> {
  return removeFromManifest(scope, "composes", name);
}

/** Drop a service from the manifest on delete — otherwise the next diff
 *  re-stages a phantom `create` ghost for a service that was just deployed. */
export function removeServiceFromManifest(scope: ProjectScope, name: string): Promise<void> {
  return removeFromManifest(scope, "services", name);
}

/** Drop a database from the manifest on delete — same phantom-create guard. */
export function removeDatabaseFromManifest(scope: ProjectScope, name: string): Promise<void> {
  return removeFromManifest(scope, "databases", name);
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
