/**
 * `manifest.discard`: drop what one environment's bar shows as pending.
 *
 * What gets reverted is decided by the same plan the bar is drawn from
 * (planEnvironmentChanges), so "Discard" means exactly the rows on screen.
 * Each of them goes back to how THIS environment last applied it (see
 * manifestAfterEnvironmentDiscard).
 *
 * It used to copy the project-wide snapshot, the manifest resolved for
 * whichever environment applied last, over the whole saved manifest. That
 * folded another environment's overrides into the shared base, so the change
 * discarded here came straight back and the bar never cleared.
 */
import type { EnvironmentId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";

import type { Manifest, ManifestMergeError } from "../../stack/manifest";
import type { SkippedResource } from "./manifest-applied-snapshot";

import { manifestSchema } from "../../stack/manifest";
import { ProjectNotFoundError } from "./errors";
import { documentAndResolved, loadManifest, type ProjectScope } from "./manifest";
import { loadAppliedElsewhere, loadEnvironmentApplied } from "./manifest-environment-applied";
import { manifestAfterEnvironmentDiscard } from "./manifest-environment-baseline";
import { pendingResources, planEnvironmentChanges } from "./manifest-plan";
import { publishManifestChanged } from "./project-event-bus";
import { deleteDraftCredentialsNotIn } from "./queries";
import { resolveProjectEnvironmentScope } from "./queries/resource";

/** The project-wide snapshot, for an environment with no record of its own
 *  yet: what discard always reverted to. Unreadable reads as none. */
async function legacySnapshot(scope: ProjectScope): Promise<Manifest | null> {
  const [row] = await db
    .select({ lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .limit(1)
    .$withCache(false);
  const parsed = manifestSchema.safeParse(row?.lastApplied);
  return parsed.success ? parsed.data : null;
}

async function writeDiscard(
  scope: ProjectScope,
  args: { environmentId: EnvironmentId; environment: string | undefined },
  resources: readonly SkippedResource[],
): Promise<Result<{ version: number }, ProjectNotFoundError>> {
  const stored = await loadManifest(scope);
  if (stored.isErr()) return stored;
  const manifest = stored.value.manifest;
  if (manifest && resources.length === 0) return Result.ok({ version: stored.value.version });

  const [own, appliedElsewhere] = await Promise.all([
    loadEnvironmentApplied(args.environmentId),
    loadAppliedElsewhere(scope.projectId, args.environmentId),
  ]);
  const nextManifest = manifestAfterEnvironmentDiscard({
    manifest,
    baseline: own.document ?? (await legacySnapshot(scope)),
    environment: args.environment,
    resources,
    appliedElsewhere,
  });

  const [updatedRow] = await db
    .update(project)
    .set({ manifest: nextManifest, manifestVersion: sql`${project.manifestVersion} + 1` })
    .where(and(eq(project.id, scope.projectId), eq(project.organizationId, scope.organizationId)))
    .returning({ version: project.manifestVersion });
  if (!updatedRow) return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));
  publishManifestChanged(scope.projectId);
  return Result.ok({ version: updatedRow.version });
}

/** Drop draft credentials for any staged database the discard removed. Keep
 *  every one the reverted manifest still declares, in its base or in any
 *  environment's block. */
async function dropOrphanedDrafts(scope: ProjectScope): Promise<void> {
  const reverted = await loadManifest(scope);
  if (reverted.isErr()) return;
  const manifest = reverted.value.manifest;
  const declared = new Set(Object.keys(manifest?.databases ?? {}));
  for (const block of Object.values(manifest?.environments ?? {})) {
    for (const [name, entry] of Object.entries(block.databases ?? {})) {
      if (entry) declared.add(name);
    }
  }
  await deleteDraftCredentialsNotIn(scope.projectId, [...declared]);
}

/** Every resource the environment's bar shows as pending. */
async function pendingIn(
  scope: ProjectScope,
  envScope: { environmentId: EnvironmentId; isMain: boolean },
  environment: string | undefined,
): Promise<Result<SkippedResource[], ProjectNotFoundError | ManifestMergeError>> {
  const loaded = await documentAndResolved(scope, environment);
  if (loaded.isErr()) return Result.err(loaded.error);
  if (!loaded.value) return Result.ok([]);
  const planned = await planEnvironmentChanges(scope.projectId, envScope, loaded.value.resolved);
  return Result.ok(pendingResources(planned));
}

export async function discardPending(
  scope: ProjectScope,
  args: {
    environment: string | undefined;
    environmentId: EnvironmentId | null;
    /** Discard only these; omitted = every change the environment shows. */
    only: readonly SkippedResource[] | undefined;
  },
): Promise<Result<{ version: number }, ProjectNotFoundError | ManifestMergeError>> {
  const envScope = await resolveProjectEnvironmentScope(scope.projectId, args.environmentId);
  if (!envScope) return Result.err(new ProjectNotFoundError({ projectId: scope.projectId }));

  // A variable is discarded with the resource that declares it: `<owner>.<KEY>`,
  // and a KEY cannot contain a dot.
  const resources = args.only
    ? Result.ok(
        args.only.map((entry) =>
          entry.resource === "env" ? { ...entry, name: entry.name.split(".")[0] ?? "" } : entry,
        ),
      )
    : await pendingIn(scope, envScope, args.environment);
  if (resources.isErr()) return Result.err(resources.error);

  const result = await writeDiscard(
    scope,
    { environmentId: envScope.environmentId, environment: args.environment },
    resources.value,
  );
  if (result.isOk()) await dropOrphanedDrafts(scope);
  return result;
}
