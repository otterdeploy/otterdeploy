/**
 * Record what an apply landed: the project's `lastAppliedManifest`, the
 * applying environment's own record, then the escape hatch and the stale-diff
 * broadcast that follow them.
 *
 * Record what LANDED, not what was asked for. A resource in `skipped[]` never
 * happened, and writing it here would bake it into the snapshot that `discard`
 * reverts to, making a failed create both unappliable (its name collides with
 * whatever did get created) and undiscardable, forever. See
 * manifest-applied-snapshot.ts.
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import type { EnvironmentApplied } from "./manifest-environment-baseline";

import { writeProjectEscapeHatch } from "../../lib/escape-hatch";
import { manifestSchema, type Manifest } from "../../stack/manifest";
import { snapshotAfterApply, type SkippedResource } from "./manifest-applied-snapshot";
import { recordEnvironmentApplied } from "./manifest-environment-applied";
import { documentAfterApply } from "./manifest-environment-baseline";
import { publishManifestChanged } from "./project-event-bus";

export async function persistApplied(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  /** The manifest the apply ran: resolved for its environment. */
  manifest: Manifest;
  /** The whole document it was resolved from, and the environment slug it was
   *  resolved for. Absent when the caller only had the resolved manifest. */
  document: Manifest | undefined;
  environment: string | undefined;
  environmentId: EnvironmentId;
  /** What this environment had applied before this run. */
  previous: EnvironmentApplied;
  skipped: readonly SkippedResource[];
}): Promise<void> {
  const { projectId, organizationId, manifest, skipped } = input;
  const [before] = await db
    .select({ lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
    .limit(1)
    .$withCache(false);
  // `lastApplied` is a jsonb column written exclusively by this pipeline from
  // schema-validated manifests, so re-parse it at the read boundary instead of
  // asserting. A row that no longer parses is treated as a first apply.
  const parsedBefore = manifestSchema.safeParse(before?.lastApplied);
  const applied = snapshotAfterApply({
    submitted: manifest,
    previous: parsedBefore.success ? parsedBefore.data : null,
    skipped,
  });

  await db
    .update(project)
    .set({ lastAppliedManifest: applied, lastManifestAppliedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)));

  // This environment's own record, reverted against ITS previous apply: the
  // project-wide snapshot above may have been written by another environment.
  await recordEnvironmentApplied(input.environmentId, {
    resolved: snapshotAfterApply({
      submitted: manifest,
      previous: input.previous.resolved,
      skipped,
    }),
    document: documentAfterApply({
      submitted: input.document ?? manifest,
      previous: input.previous.document,
      skipped,
      environment: input.document ? input.environment : undefined,
    }),
  });

  // Refresh the project's DR escape hatch (rendered compose + JSON snapshot)
  // from the now-current rows. Best-effort: it never throws, never blocks the
  // apply result, and no-ops when the data folder isn't writable.
  await writeProjectEscapeHatch(organizationId, projectId);

  // lastAppliedManifest just moved, so every open tab's pending-changes diff
  // is stale, announce it so the stream resyncs them now instead of at the
  // slow poll backstop.
  publishManifestChanged(projectId);
}
