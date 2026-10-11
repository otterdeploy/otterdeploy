/**
 * Reconciler: execute a manifest diff plan against the project's resources.
 * Calls the existing service/database handlers so the wire path is identical to
 * the equivalent UI clicks; the manifest just decides what to call.
 *
 * Execution order (phases run in sequence; resources WITHIN a phase run in
 * parallel: they're mutually independent once the prior phase has settled):
 *   1. Database creates                     (services may reference them)
 *   2. Resolve refs in service env values   (database rows exist by step 1;
 *                                            services created in step 3 resolve
 *                                            by the hostname they will get)
 *   3. Service creates
 *   4. Service updates (fields + env)
 *   4b. Compose stack creates
 *   5. Database updates (publicEnabled + extraEnv)
 *   6. Service deletes
 *   7. Database deletes
 *   8. Build git services created earlier that never started a build
 *
 * A git service's build is enqueued by phase 3/4 the moment it is created or
 * updated, never deferred to the end: a later phase that aborts the apply
 * would otherwise leave it created and never built.
 *
 * The per-phase logic lives in ./manifest-apply-phases; the handlers it calls
 * live in the ./manifest-apply-{services,databases,refs,git} siblings.
 */

import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import { createError } from "evlog";

import type { Manifest } from "../../stack/manifest";
import type { ApplyContext, PhaseContribution, StartedRollout } from "./manifest-apply-phases";

import { writeProjectEscapeHatch } from "../../lib/escape-hatch";
import { diffManifest, manifestSchema } from "../../stack/manifest";
import { loadAppliedSnapshot } from "./manifest";
import { snapshotAfterApply } from "./manifest-applied-snapshot";
import {
  runComposeCreates,
  runDatabaseCreates,
  runDatabaseDeletes,
  runDatabaseUpdates,
  runGitBuilds,
  runServiceDeletes,
} from "./manifest-apply-phases";
import {
  runServiceCreates,
  runServiceUpdates,
  unbuiltGitServices,
} from "./manifest-apply-phases-services";
import { loadRefTable, makeEnvRefResolver, withStagedServices } from "./manifest-apply-refs";
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
  /** Image services this apply started rolling; each continues in the
   *  background and records its outcome on its deployment. */
  rollouts: StartedRollout[];
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
  /** Services whose source the caller uploads right after this apply. See
   *  the applyChange contract; only upload-sourced services are honoured. */
  sourceUploads?: ReadonlyArray<string>;
  /** Who asked for this apply; see ApplyContext.actorUserId. */
  actorUserId?: string | null;
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

/**
 * Record what landed: `lastAppliedManifest`, then the escape hatch and the
 * stale-diff broadcast that follow it.
 *
 * Record what LANDED, not what was asked for. A resource in `skipped[]` never
 * happened, and writing it here would bake it into the snapshot that `discard`
 * reverts to, making a failed create both unappliable (its name collides with
 * whatever did get created) and undiscardable, forever. See
 * manifest-applied-snapshot.ts.
 */
async function persistApplied(input: {
  projectId: ProjectId;
  organizationId: OrganizationId;
  manifest: Manifest;
  skipped: ApplyResult["skipped"];
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

  // Refresh the project's DR escape hatch (rendered compose + JSON snapshot)
  // from the now-current rows. Best-effort: it never throws, never blocks the
  // apply result, and no-ops when the data folder isn't writable.
  await writeProjectEscapeHatch(organizationId, projectId);

  // lastAppliedManifest just moved, so every open tab's pending-changes diff
  // is stale, announce it so the stream resyncs them now instead of at the
  // slow poll backstop.
  publishManifestChanged(projectId);
}

async function runApply(input: ApplyInput): Promise<ApplyResult> {
  const { projectId, organizationId, manifest, environmentId, only, sourceUploads, log } = input;
  const actorUserId = input.actorUserId ?? null;
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
    scope,
    organizationId,
    manifest,
    current,
    sourceUploads: new Set(sourceUploads),
    actorUserId,
    log,
  };
  // Plan with the same ref resolver the router's diff endpoint uses, so what
  // the user previewed is what executes. This table predates the DB-create
  // phase on purpose: refs to a database created THIS apply stay unresolved in
  // the plan (its env changes read as creates) and resolve in the write-path
  // refTable loaded after phase 1.
  // Services this manifest declares that don't exist yet: refs to them resolve
  // to the hostname they are about to get (withStagedServices).
  const stagedServices = Object.keys(manifest.services).filter((n) => !current.services[n]);
  const planRefTable = withStagedServices(await loadRefTable(projectId, scope), stagedServices);
  // Same applied snapshot the diff endpoint uses, so what the operator
  // previewed is what executes: without it apply would compute deletes the
  // preview never showed.
  const appliedSnapshot = await loadAppliedSnapshot({ projectId, organizationId });
  const planned = diffManifest(manifest, current, {
    resolveEnvValue: makeEnvRefResolver(planRefTable),
    applied: appliedSnapshot,
  });
  const byKind = groupChanges(planned);

  let appliedCount = 0;
  const skipped: ApplyResult["skipped"] = [];
  const rollouts: StartedRollout[] = [];

  // Cherry-pick. Split each planned list into "run now" and "leave staged"
  // BEFORE any phase executes, and route the deferred half into `skipped`.
  //
  // `skipped` is the right channel rather than a parallel concept:
  // `snapshotAfterApply` already reverts every skipped resource to the
  // previous manifest (manifest-applied-snapshot.ts), which is exactly
  // "stays pending". A failed create and a deliberately-deferred create want
  // the same treatment in the snapshot, so they share the path.
  // `env` selections are mapped onto their OWNER before matching.
  //
  // Env changes never reach the plan as themselves: groupChanges folds a
  // service's variable edits into a synthesized `service` update named after
  // the owner. `pick` only ever compares service/database/compose keys, so an
  // `only` entry like {resource:"env", name:"api-prod.CORS_ORIGIN"} — a shape
  // the contract explicitly accepts — matched nothing, was never reported as
  // skipped, and the apply returned success having reconciled nothing.
  //
  // The owner is the part before the first dot: env change names are
  // `<owner>.<KEY>`, and a KEY cannot contain a dot (envKeyRegex).
  const selectedKeys =
    only === undefined
      ? null
      : only.map((o) =>
          o.resource === "env" ? `service:${o.name.split(".")[0]}` : `${o.resource}:${o.name}`,
        );
  const selected = selectedKeys === null ? null : new Set(selectedKeys);
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
      skipped.push({ resource: e.resource, name: e.resourceName, reason: e.reason });
    rollouts.push(...(c.rollouts ?? []));
  };

  // Every change this apply will run, tagged with its resource kind. A phase
  // marks its changes before it runs; on an abort the unmarked ones never ran.
  const toRun: ReadonlyArray<
    readonly [resource: "service" | "database" | "compose", change: { name: string }]
  > = [
    ...plan.databaseCreates.map((c) => ["database", c] as const),
    ...plan.serviceDeletes.map((c) => ["service", c] as const),
    ...plan.serviceCreates.map((c) => ["service", c] as const),
    ...plan.serviceUpdates.map((c) => ["service", c] as const),
    ...plan.composeCreates.map((c) => ["compose", c] as const),
    ...plan.databaseUpdates.map((c) => ["database", c] as const),
    ...plan.databaseDeletes.map((c) => ["database", c] as const),
  ];
  // A change counts as reached once its phase starts, even if that phase then
  // throws part-way. Recording one that did not land costs a create the next
  // diff re-proposes; dropping one that did land orphans it for good.
  const reached = new Set<{ name: string }>();
  const starting = <T extends { name: string }>(changes: T[]): T[] => {
    for (const change of changes) reached.add(change);
    return changes;
  };

  // The snapshot of what landed is written after the last phase. A hard throw
  // anywhere in between would skip it while the rows earlier phases wrote stay,
  // so it is written on the way out too. No `catch`: the error propagates as
  // it was.
  let completed = false;
  try {
    // 1. Database creates first. Services may reference them.
    fold(await runDatabaseCreates(ctx, starting(plan.databaseCreates)));
    // 2. Build the ${database:…}/${service:…} ref table now the database rows
    // exist, with the services this apply creates already in it, so a ref to
    // one lands in THIS apply instead of a second one.
    const refTable = withStagedServices(
      await loadRefTable(projectId, scope),
      plan.serviceCreates.map((c) => c.name),
    );
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
    fold(await runServiceDeletes(ctx, starting(replaceDeletes)));
    fold(await runServiceCreates(ctx, starting(plan.serviceCreates), refTable));
    fold(await runServiceUpdates(ctx, starting(plan.serviceUpdates), refTable));
    fold(await runComposeCreates(ctx, starting(plan.composeCreates)));
    fold(await runDatabaseUpdates(ctx, starting(plan.databaseUpdates)));
    fold(await runServiceDeletes(ctx, starting(standaloneDeletes)));
    fold(await runDatabaseDeletes(ctx, starting(plan.databaseDeletes)));

    // 8. A git service with no change of its own that was created and never
    // built (an earlier apply was cut short before its build) builds now, if
    // this apply covers it. A failure joins skipped[].
    const unchanged = planned
      .filter((c) => c.kind === "no-op" && c.resource === "service")
      .map((c) => c.name)
      .filter((name) => selected === null || selected.has(`service:${name}`));
    for (const e of await runGitBuilds(ctx, await unbuiltGitServices(ctx, unchanged))) {
      skipped.push({ resource: e.resource, name: e.resourceName, reason: e.reason });
    }
    completed = true;
  } finally {
    if (!completed) {
      for (const [resource, change] of toRun) {
        if (reached.has(change)) continue;
        skipped.push({
          resource,
          name: change.name,
          reason: "the apply stopped before reaching this resource",
        });
      }
      // Best-effort: the error already on its way out is the one the caller
      // needs, so a second failure here must not replace it.
      await Result.tryPromise({
        try: () => persistApplied({ projectId, organizationId, manifest, skipped }),
        catch: (cause) => cause,
      });
    }
  }

  // Outside the `finally`, so a failure of the normal write surfaces as itself.
  await persistApplied({ projectId, organizationId, manifest, skipped });

  return {
    appliedCount,
    skipped,
    lastAppliedAt: new Date().toISOString(),
    rollouts,
  };
}
