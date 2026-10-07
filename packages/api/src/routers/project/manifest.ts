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
import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";
import { log as globalLog } from "evlog";
import * as z from "zod";

import { manifestSchema, resolveEnvironment, type Manifest } from "../../stack/manifest";
import { ManifestVersionConflictError, ProjectNotFoundError } from "./errors";
import { manifestAfterDiscard, type SkippedResource } from "./manifest-applied-snapshot";
import { publishManifestChanged } from "./project-event-bus";

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
  const stored = storedManifest(row.manifest);
  if (stored.kind === "poisoned") await repairPoisonedManifest(scope, row.version);
  if (stored.kind === "unreadable") {
    globalLog.warn({
      message: "[manifest] stored manifest fails the schema; reading it as absent",
      projectId: scope.projectId,
      issues: stored.issues,
    });
  }
  return Result.ok({ manifest: stored.manifest, version: row.version });
}

/**
 * What a selective discard on a never-saved, never-applied manifest used to
 * store: the bare sections, no `project`. manifestSchema rejects
 * it, so every read of such a project was a ZodError 500. It means "nothing
 * staged", which is exactly an absent manifest.
 */
const poisonedManifestSchema = z.strictObject({
  services: z.strictObject({}),
  databases: z.strictObject({}),
  composes: z.strictObject({}),
});

type StoredManifest =
  | { kind: "absent" | "poisoned"; manifest: null }
  | { kind: "valid"; manifest: Manifest }
  | { kind: "unreadable"; manifest: null; issues: string[] };

/**
 * The stored `project.manifest` jsonb, read tolerantly. Never throws: a value
 * the schema rejects reads as absent (and is reported as such) instead of
 * failing every read of the project. Only the known discard poison is
 * rewritten (`repairPoisonedManifest`); anything else is left in place for
 * an operator to recover.
 */
function storedManifest(raw: unknown): StoredManifest {
  if (raw === null || raw === undefined) return { kind: "absent", manifest: null };
  const parsed = manifestSchema.safeParse(raw);
  if (parsed.success) return { kind: "valid", manifest: parsed.data };
  if (poisonedManifestSchema.safeParse(raw).success) return { kind: "poisoned", manifest: null };
  return {
    kind: "unreadable",
    manifest: null,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}

/**
 * Rewrite a poisoned manifest to the null it stands for. Best-effort, and
 * only while the version is unchanged, so it can never clobber a concurrent
 * save. The version is not bumped: the content is the same "nothing staged".
 */
async function repairPoisonedManifest(scope: ProjectScope, version: number): Promise<void> {
  const repaired = await Result.tryPromise(() =>
    db
      .update(project)
      .set({ manifest: null })
      .where(
        and(
          eq(project.id, scope.projectId),
          eq(project.organizationId, scope.organizationId),
          eq(project.manifestVersion, version),
        ),
      ),
  );
  if (repaired.isErr()) {
    globalLog.warn({
      message: "[manifest] could not repair a poisoned manifest; it still reads as absent",
      projectId: scope.projectId,
      error: repaired.error.message,
    });
  }
}

/**
 * The last successfully-applied snapshot, or null when this project has never
 * applied one.
 *
 * The diff needs it to tell a DELETE from an unmanaged resource: absent from
 * the manifest AND absent from here means the manifest never owned it, so its
 * disappearance is not something to stage a destructive change from. See
 * `wasDeclaredBefore` in stack/manifest/diff.ts.
 *
 * Safe-parsed, not asserted: a snapshot written by an older schema must read
 * as "no snapshot" (nothing is deletable) rather than throw on the read path
 * of every diff.
 */
export async function loadAppliedSnapshot(scope: ProjectScope): Promise<Manifest | null> {
  const [row] = await db
    .select({ lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);
  const parsed = manifestSchema.safeParse(row?.lastApplied);
  return parsed.success ? parsed.data : null;
}

/**
 * What a save would REMOVE, relative to the manifest already stored.
 *
 * `manifest.save` replaces the whole document, so a payload that merely omits
 * a resource deletes it. That is a defensible design for a declarative
 * document, but it means the difference between "update one field" and "wipe
 * the project" is invisible at the call site: the correct read-modify-write
 * pattern has to be inferred, and only the `expectedVersion` check stands
 * between a malformed payload and a project with no services (od-mizn).
 *
 * PURE, so the dangerous part is the part that is testable.
 */
export interface ManifestRemoval {
  resource: "service" | "database" | "compose";
  name: string;
}

export function manifestRemovals(current: Manifest | null, next: Manifest): ManifestRemoval[] {
  if (!current) return [];
  const sections = [
    ["service", current.services, next.services],
    ["database", current.databases, next.databases],
    ["compose", current.composes, next.composes],
  ] as const;

  const removals: ManifestRemoval[] = [];
  for (const [resource, before, after] of sections) {
    for (const name of Object.keys(before ?? {})) {
      if (!(name in (after ?? {}))) removals.push({ resource, name });
    }
  }
  // Stable order: a diff the operator reads twice should not reshuffle.
  return removals.sort(
    (a, b) => a.resource.localeCompare(b.resource) || a.name.localeCompare(b.name),
  );
}

/** Optimistic-locked write. Bump only when expectedVersion matches. */
export async function saveManifest(
  scope: ProjectScope,
  input: { manifest: Manifest; expectedVersion: number },
): Promise<Result<{ version: number }, ProjectNotFoundError | ManifestVersionConflictError>> {
  const [updatedRow] = await db
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

  if (updatedRow) {
    publishManifestChanged(scope.projectId);
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
 * Discard pending manifest changes. Revert to the last successfully
 * applied snapshot. `lastAppliedManifest` is updated by applyManifest
 * on every successful reconcile; this just copies it back into
 * `manifest`, bumping the version counter so concurrent CLI/UI sessions
 * see a fresh state.
 *
 * If the project has never been applied, the manifest is cleared (null).
 */
export async function discardManifest(
  scope: ProjectScope,
  /** Discard only these; omitted = discard every pending change. */
  only?: readonly SkippedResource[],
): Promise<Result<{ version: number }, ProjectNotFoundError>> {
  const [row] = await db
    .select({ manifest: project.manifest, lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1);
  if (!row) return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));

  const nextManifest = manifestAfterDiscard({
    // jsonb columns are typed as free-form JSON; storedManifest is the
    // boundary that turns them back into Manifest, same as loadManifest (a
    // poisoned or unreadable value discards as absent instead of throwing).
    manifest: storedManifest(row.manifest).manifest,
    applied: storedManifest(row.lastApplied).manifest,
    only,
  });

  const [updatedRow] = await db
    .update(project)
    .set({
      manifest: nextManifest,
      manifestVersion: sql`${project.manifestVersion} + 1`,
    })
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .returning({ version: project.manifestVersion });

  if (!updatedRow) {
    return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  }
  publishManifestChanged(scope.projectId);
  return Result.ok({ version: updatedRow.version });
}

/**
 * Mirror a live compose-content edit (compose.updateContent) into the desired
 * manifest so the manifest stays the source of truth. Inline stacks only. A
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
 * a phantom `create`. The "pending create" ghost that reappears after a deployed
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

  const strip = (m: JsonObject | null): JsonObject | null => {
    const coll = m?.[collection];
    if (!m || !isJsonObject(coll) || !(name in coll)) return m;
    const rest = { ...coll };
    delete rest[name];
    return { ...m, [collection]: rest };
  };

  const nextManifest = strip(row.manifest);
  const nextApplied = strip(row.lastApplied);
  // Nothing referenced this resource: leave the version untouched.
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

/** Drop a service from the manifest on delete. Otherwise the next diff
 *  re-stages a phantom `create` ghost for a service that was just deployed. */
export function removeServiceFromManifest(scope: ProjectScope, name: string): Promise<void> {
  return removeFromManifest(scope, "services", name);
}

/** Drop a database from the manifest on delete. Same phantom-create guard. */
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
