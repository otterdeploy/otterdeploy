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

import type { ManifestMergeError } from "../../stack/manifest";

import { manifestSchema, resolveEnvironment, type Manifest } from "../../stack/manifest";
import {
  ManifestProjectMismatchError,
  ManifestVersionConflictError,
  ProjectNotFoundError,
} from "./errors";
import { forgetAppliedEverywhere } from "./manifest-environment-applied";
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
    .limit(1)
    // Never from the query cache. This is the optimistic-locked document every
    // save, diff and apply starts from; a cached copy taken before the last
    // save made apply see the EMPTY manifest and answer success having applied
    // nothing, for up to the cache TTL.
    .$withCache(false);

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

/** Optimistic-locked write. Bump only when expectedVersion matches. */
export async function saveManifest(
  scope: ProjectScope,
  input: { manifest: Manifest; expectedVersion: number },
): Promise<
  Result<
    { version: number },
    ProjectNotFoundError | ManifestVersionConflictError | ManifestProjectMismatchError
  >
> {
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
        // The manifest names its own project, and the CLI resolves its target
        // from that name. Part of the same write so a mismatch never lands.
        eq(project.slug, input.manifest.project),
      ),
    )
    .returning({ version: project.manifestVersion });

  if (updatedRow) {
    publishManifestChanged(scope.projectId);
    return Result.ok({ version: updatedRow.version });
  }

  const [current] = await db
    .select({ version: project.manifestVersion, slug: project.slug })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1)
    // The version a retry must send: a cached one would conflict again.
    .$withCache(false);
  if (!current) {
    return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  }
  // A stale version first: after a rename the client's copy may name the old
  // slug, and re-reading (what a conflict asks for) is what fixes that.
  if (current.version !== input.expectedVersion) {
    return Result.err(new ManifestVersionConflictError({ currentVersion: current.version }));
  }
  return Result.err(
    new ManifestProjectMismatchError({ expected: current.slug, received: input.manifest.project }),
  );
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

  await forgetAppliedEverywhere(scope.projectId, collection, name);
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
): Promise<Result<Manifest | null, ProjectNotFoundError | ManifestMergeError>> {
  const loaded = await documentAndResolved(scope, environment);
  return loaded.map((value) => value?.resolved ?? null);
}

/** The saved document and the same document resolved for `environment`. */
export async function documentAndResolved(
  scope: ProjectScope,
  environment?: string,
): Promise<
  Result<
    { document: Manifest; resolved: Manifest } | null,
    ProjectNotFoundError | ManifestMergeError
  >
> {
  const row = await loadManifest(scope);
  if (row.isErr()) return Result.err(row.error);
  const document = row.value.manifest;
  if (!document) return Result.ok(null);
  return resolveEnvironment(document, environment).map((resolved) => ({ document, resolved }));
}
