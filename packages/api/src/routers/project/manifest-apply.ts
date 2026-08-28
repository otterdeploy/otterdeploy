/**
 * Reconciler: execute a manifest diff plan against the project's resources.
 * Calls the existing service/database handlers so the wire path is identical to
 * the equivalent UI clicks; the manifest just decides what to call.
 *
 * Execution order (phases run in sequence; resources WITHIN a phase run in
 * parallel: they're mutually independent once the prior phase has settled):
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

import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";
import { createError } from "evlog";

import type { Manifest } from "../../stack/manifest";
import type { ApplyContext, GitBuild, PhaseContribution } from "./manifest-apply-phases";

import { writeProjectEscapeHatch } from "../../lib/escape-hatch";
import { diffManifest, manifestSchema } from "../../stack/manifest";
import { snapshotAfterApply } from "./manifest-applied-snapshot";
import {
  runComposeCreates,
  runDatabaseCreates,
  runDatabaseDeletes,
  runDatabaseUpdates,
  runGitBuilds,
  runServiceDeletes,
} from "./manifest-apply-phases";
import { runServiceCreates, runServiceUpdates } from "./manifest-apply-phases-services";
import { loadRefTable, makeEnvRefResolver } from "./manifest-apply-refs";
import { groupChanges } from "./manifest-apply-support";
import { loadCurrentState } from "./manifest-state";
import { publishManifestChanged } from "./project-event-bus";
import { resolveProjectEnvironmentScope } from "./queries/resource";

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
  /** Environment this apply targets. Omitted/null = the project's main
   *  environment, which is stored as `environment_id IS NULL`. The manifest
   *  passed in has ALREADY been resolved for this environment; this is what
   *  scopes the deployed state it gets diffed against, so the two agree. */
  environmentId?: EnvironmentId | null;
  /** Apply only these resources; every other staged change stays PENDING.
   *  Omitted = apply everything. See the contract for why this is not the
   *  same as a selective discard. */
  only?: ReadonlyArray<{ resource: "service" | "database" | "env" | "compose"; name: string }>;
  log: ApplyContext["log"];
}

// One reconcile at a time per project. Two concurrent applies (Deploy click +
// applyChange from a panel, a double-click, CLI + UI) would both diff the same
// pre-state and both try to create the same containers. The loser dies on a
// docker name Conflict. Queue them instead: the second run re-reads current
// state AFTER the first finishes, so its diff sees the work as already done.
const applyQueues = new Map<ProjectId, Promise<unknown>>();

export function applyManifest(input: ApplyInput): Promise<ApplyResult> {
  const prev = applyQueues.get(input.projectId) ?? Promise.resolve();
  const run = prev.then(() => runApply(input));
  const settled: Promise<void> = run.then(
    () => undefined,
    () => undefined,
  );
  applyQueues.set(input.projectId, settled);
  void settled.then(() => {
    if (applyQueues.get(input.projectId) === settled) applyQueues.delete(input.projectId);
  });
  return run;
}

async function runApply(input: ApplyInput): Promise<ApplyResult> {
  const { projectId, organizationId, manifest, environmentId, only, log } = input;
  // Load state inside the queue slot. A snapshot taken while a prior apply
  // was still running would re-plan (and re-provision) its work.
  // Resolve to a concrete scope before diffing. A project with no environment
  // pointer cannot be diffed safely. Every existing resource would look absent
  // and the plan would be all-creates, so refuse rather than guess.
  const scope = await resolveProjectEnvironmentScope(projectId, environmentId);
  if (!scope) {
    throw createError({
      message: "Project has no environment to apply against",
      status: 409,
      why: `Project ${projectId} has no environment_id pointer, so the manifest cannot be scoped`,
    });
  }
  const current = await loadCurrentState(projectId, scope);
  const ctx: ApplyContext = {
    projectId,
    environmentId: scope.environmentId,
    organizationId,
    manifest,
    current,
    log,
  };
  // Plan with the same ref resolver the router's diff endpoint uses, so what
  // the user previewed is what executes. This table predates the DB-create
  // phase on purpose: refs to a database created THIS apply stay unresolved in
  // the plan (its env changes read as creates) and resolve in the write-path
  // refTable loaded after phase 1.
  const planRefTable = await loadRefTable(projectId);
  const byKind = groupChanges(
    diffManifest(manifest, current, { resolveEnvValue: makeEnvRefResolver(planRefTable) }),
  );

  let appliedCount = 0;
  const skipped: ApplyResult["skipped"] = [];
  const gitBuilds: GitBuild[] = [];

  // Cherry-pick. Split each planned list into "run now" and "leave staged"
  // BEFORE any phase executes, and route the deferred half into `skipped`.
  //
  // `skipped` is the right channel rather than a parallel concept:
  // `snapshotAfterApply` already reverts every skipped resource to the
  // previous manifest (manifest-applied-snapshot.ts), which is exactly
  // "stays pending". A failed create and a deliberately-deferred create want
  // the same treatment in the snapshot, so they share the path.
  const selected = only === undefined ? null : new Set(only.map((o) => `${o.resource}:${o.name}`));
  const pick = <T extends { name: string }>(
    items: T[],
    resource: "service" | "database" | "compose",
  ): T[] => {
    if (selected === null) return items;
    const run: T[] = [];
    for (const item of items) {
      if (selected.has(`${resource}:${item.name}`)) run.push(item);
      else skipped.push({ resource, name: item.name, reason: "not selected for this apply" });
    }
    return run;
  };
  const plan = {
    databaseCreates: pick(byKind.databaseCreates, "database"),
    databaseUpdates: pick(byKind.databaseUpdates, "database"),
    databaseDeletes: pick(byKind.databaseDeletes, "database"),
    serviceCreates: pick(byKind.serviceCreates, "service"),
    serviceUpdates: pick(byKind.serviceUpdates, "service"),
    serviceDeletes: pick(byKind.serviceDeletes, "service"),
    composeCreates: pick(byKind.composeCreates, "compose"),
  };

  const fold = (c: PhaseContribution): void => {
    appliedCount += c.applied;
    for (const e of c.skipped)
      skipped.push({ resource: e.resource, name: e.name, reason: e.reason });
    gitBuilds.push(...c.gitBuilds);
  };

  // 1. Database creates first. Services may reference them.
  fold(await runDatabaseCreates(ctx, plan.databaseCreates));
  // 2. Build the ${database:…}/${service:…} ref table now the rows exist.
  const refTable = await loadRefTable(projectId);
  // A source change diffs to delete+create of the SAME name (see diff.ts) and
  // MUST delete before it creates. Otherwise the create collides with the
  // still-live resource ("service already exists") and is skipped, leaving the
  // service torn down and never recreated. Split those replace-deletes out and
  // run them first; unrelated deletes stay last (frees their ports/domains
  // without tearing anything down early).
  const createdServiceNames = new Set(plan.serviceCreates.map((c) => c.name));
  const replaceDeletes = plan.serviceDeletes.filter((c) => createdServiceNames.has(c.name));
  const standaloneDeletes = plan.serviceDeletes.filter((c) => !createdServiceNames.has(c.name));

  // 3-7. Same-name replace-deletes, then creates, updates, then deletes.
  fold(await runServiceDeletes(ctx, replaceDeletes));
  fold(await runServiceCreates(ctx, plan.serviceCreates, refTable));
  fold(await runServiceUpdates(ctx, plan.serviceUpdates, refTable));
  fold(await runComposeCreates(ctx, plan.composeCreates));
  fold(await runDatabaseUpdates(ctx, plan.databaseUpdates));
  fold(await runServiceDeletes(ctx, standaloneDeletes));
  fold(await runDatabaseDeletes(ctx, plan.databaseDeletes));

  // 8. Enqueue builds for the git-sourced services collected above. A failure
  // means the resource exists but won't build, so it joins skipped[].
  for (const e of await runGitBuilds(ctx, gitBuilds)) {
    skipped.push({ resource: e.resource, name: e.name, reason: e.reason });
  }

  // Record what LANDED, not what was asked for. A resource in `skipped[]`
  // never happened, and writing it here would bake it into the snapshot that
  // `discard` reverts to, making a failed create both unappliable (its name
  // collides with whatever did get created) and undiscardable, forever. See
  // manifest-applied-snapshot.ts.
  const [before] = await db
    .select({ lastApplied: project.lastAppliedManifest })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
    .limit(1);
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

  // Refresh the project's DR escape hatch (rendered compose + JSON snapshot)
  // from the now-current rows. Best-effort: it never throws, never blocks the
  // apply result, and no-ops when the data folder isn't writable.
  await writeProjectEscapeHatch(organizationId, projectId);

  // lastAppliedManifest just moved, so every open tab's pending-changes diff
  // is stale, announce it so the stream resyncs them now instead of at the
  // slow poll backstop.
  publishManifestChanged(projectId);

  return {
    appliedCount,
    skipped,
    lastAppliedAt: new Date().toISOString(),
  };
}
