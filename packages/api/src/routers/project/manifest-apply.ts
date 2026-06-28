/**
 * Reconciler — execute a manifest diff plan against the project's resources.
 * Calls the existing service/database handlers so the wire path is identical to
 * the equivalent UI clicks; the manifest just decides what to call.
 *
 * Execution order (phases run in sequence; resources WITHIN a phase run in
 * parallel — they're mutually independent once the prior phase has settled):
 *   1. Database creates                     (services may reference them)
 *   2. Resolve refs in service env values   (database rows exist by step 1)
 *   3. Service creates
 *   4. Service updates (fields + env)
 *   4b. Compose stack creates
 *   5. Database updates (publicEnabled + extraEnv)
 *   6. Service deletes
 *   7. Database deletes
 *   8. Enqueue builds for git-sourced service creates/updates
 *
 * The per-phase logic lives in ./manifest-apply-phases; the handlers it calls
 * live in the ./manifest-apply-{services,databases,refs,git} siblings.
 */

import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import type { CurrentState, Manifest } from "../../stack/manifest";
import type { ApplyContext, GitBuild, PhaseContribution } from "./manifest-apply-phases";

import { writeProjectEscapeHatch } from "../../lib/escape-hatch";
import { diffManifest } from "../../stack/manifest";
import {
  runComposeCreates,
  runDatabaseCreates,
  runDatabaseDeletes,
  runDatabaseUpdates,
  runGitBuilds,
  runServiceDeletes,
} from "./manifest-apply-phases";
import { runServiceCreates, runServiceUpdates } from "./manifest-apply-phases-services";
import { loadRefTable } from "./manifest-apply-refs";
import { groupChanges } from "./manifest-apply-support";

export { enqueueGitBuild } from "./manifest-apply-git";

export interface ApplyResult {
  appliedCount: number;
  skipped: Array<{
    resource: "service" | "database" | "env" | "compose";
    name: string;
    reason: string;
  }>;
  lastAppliedAt: string;
}

export interface ApplyInput {
  projectId: ProjectId;
  organizationId: OrganizationId;
  manifest: Manifest;
  current: CurrentState;
  log: ApplyContext["log"];
}

export async function applyManifest(input: ApplyInput): Promise<ApplyResult> {
  const { projectId, organizationId, manifest, current, log } = input;
  const ctx: ApplyContext = { projectId, organizationId, manifest, current, log };
  const byKind = groupChanges(diffManifest(manifest, current));

  let appliedCount = 0;
  const skipped: ApplyResult["skipped"] = [];
  const gitBuilds: GitBuild[] = [];

  const fold = (c: PhaseContribution): void => {
    appliedCount += c.applied;
    for (const e of c.skipped)
      skipped.push({ resource: e.resource, name: e.name, reason: e.reason });
    gitBuilds.push(...c.gitBuilds);
  };

  // 1. Database creates first — services may reference them.
  fold(await runDatabaseCreates(ctx, byKind.databaseCreates));
  // 2. Build the ${database:…}/${service:…} ref table now the rows exist.
  const refTable = await loadRefTable(projectId);
  // 3-7. Service/compose/database creates, updates, then deletes.
  fold(await runServiceCreates(ctx, byKind.serviceCreates, refTable));
  fold(await runServiceUpdates(ctx, byKind.serviceUpdates, refTable));
  fold(await runComposeCreates(ctx, byKind.composeCreates));
  fold(await runDatabaseUpdates(ctx, byKind.databaseUpdates));
  fold(await runServiceDeletes(ctx, byKind.serviceDeletes));
  fold(await runDatabaseDeletes(ctx, byKind.databaseDeletes));

  // 8. Enqueue builds for the git-sourced services collected above. A failure
  // means the resource exists but won't build, so it joins skipped[].
  for (const e of await runGitBuilds(ctx, gitBuilds)) {
    skipped.push({ resource: e.resource, name: e.name, reason: e.reason });
  }

  await db
    .update(project)
    .set({ lastAppliedManifest: manifest, lastManifestAppliedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)));

  // Refresh the project's DR escape hatch (rendered compose + JSON snapshot)
  // from the now-current rows. Best-effort — it never throws, never blocks the
  // apply result, and no-ops when the data folder isn't writable.
  await writeProjectEscapeHatch(projectId);

  return {
    appliedCount,
    skipped,
    lastAppliedAt: new Date().toISOString(),
  };
}
