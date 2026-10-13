/**
 * Service create/update phases of the manifest reconciler. Split from the rest
 * of the phases because each per-service step is heavier. Env-ref resolution,
 * domain seeding on create, and the pending-build enqueue on update.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, eq, isNotNull, like, notExists } from "drizzle-orm";

import type { RolloutTiming } from "../service/handlers";
import type {
  ApplyContext,
  GitBuild,
  PhaseContribution,
  StartedRollout,
} from "./manifest-apply-phases";

import { declaredEnvOf, type Change, type ServiceManifest } from "../../stack/manifest";
import { missingDomains } from "../../stack/manifest/diff-helpers";
import { ManifestApplySkipError } from "./errors";
import { runGitBuilds } from "./manifest-apply-phases";
import { type RefTable, resolveEnv } from "./manifest-apply-refs";
import {
  createServiceFromManifest,
  seedServiceDomains,
  type ServiceApplied,
  updateServiceFromManifest,
} from "./manifest-apply-services";
import { lookupServiceId } from "./manifest-apply-support";

interface ServiceCreateOutcome {
  created: Result<ServiceApplied, ManifestApplySkipError>;
  localSkipped: ManifestApplySkipError[];
  name: string;
}

async function createOneService(
  ctx: ApplyContext,
  change: Change,
  refTable: RefTable,
): Promise<ServiceCreateOutcome | null> {
  const spec = ctx.manifest.services[change.name];
  if (!spec) return null;
  const resolved = resolveEnv(
    change.name,
    spec.env,
    refTable,
    ctx.current.services[change.name]?.env ?? {},
  );
  const localSkipped = [...resolved.skipped];
  const created = await createServiceFromManifest({
    projectId: ctx.projectId,
    environmentId: ctx.environmentId,
    organizationId: ctx.organizationId,
    name: change.name,
    spec,
    env: resolved.values,
    log: ctx.log,
  });
  // The build is enqueued the moment the row exists, not at the end of the
  // apply: every later phase (other services, stacks, databases, deletes) can
  // abort the apply, and a build deferred past one never started, leaving a
  // created service on its placeholder image with nothing to build it.
  if (created.isOk() && spec.source === "git") {
    localSkipped.push(
      ...(await runGitBuilds(ctx, [{ resourceId: created.value.resourceId, name: change.name }])),
    );
  }
  // Seed manifest-declared public domains onto the freshly-created service
  // (create-time only). Failures are non-fatal skips. The service itself is
  // already created; a bad/portless domain shouldn't roll that back.
  if (created.isOk() && spec.domains?.length) {
    for (const s of await seedServiceDomains({
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      resourceId: created.value.resourceId,
      name: change.name,
      domains: spec.domains,
      log: ctx.log,
    })) {
      localSkipped.push(s);
    }
  }
  return { created, localSkipped, name: change.name };
}

export async function runServiceCreates(
  ctx: ApplyContext,
  changes: Change[],
  refTable: RefTable,
): Promise<PhaseContribution> {
  const outcomes = await Promise.all(
    changes.map((change) => createOneService(ctx, change, refTable)),
  );
  let applied = 0;
  const skipped: ManifestApplySkipError[] = [];
  const rollouts: StartedRollout[] = [];
  for (const o of outcomes) {
    if (!o) continue;
    skipped.push(...o.localSkipped);
    if (o.created.isOk()) applied += 1;
    else skipped.push(o.created.error);
    rollouts.push(...startedRollout(o.name, o.created));
  }
  return { applied, skipped, rollouts };
}

interface ServiceUpdateOutcome {
  updated: Result<ServiceApplied, ManifestApplySkipError>;
  localSkipped: ManifestApplySkipError[];
  name: string;
}

async function updateOneService(
  ctx: ApplyContext,
  change: Change,
  refTable: RefTable,
): Promise<ServiceUpdateOutcome | null> {
  const spec = ctx.manifest.services[change.name];
  const existingId = await lookupServiceId(ctx.projectId, change.name, ctx.scope);
  if (!spec || !existingId) return null;
  const resolved = resolveEnv(
    change.name,
    declaredEnvOf(spec.env),
    refTable,
    ctx.current.services[change.name]?.env ?? {},
  );
  // A git service created but never successfully built sits on a `pending:*`
  // image with no deployment. Builds normally fire only on create (or git
  // push), so without this a "Deploy" on such a stuck service no-ops forever.
  const builds: GitBuild[] =
    spec.source === "git" && (await hasPendingImage(existingId))
      ? [{ resourceId: existingId, name: change.name }]
      : [];
  // A change that only adds domains attaches them and rolls nothing.
  const updated = domainsOnly(change)
    ? Result.ok<ServiceApplied, ManifestApplySkipError>({
        resourceId: existingId,
        deploymentId: null,
      })
    : await updateServiceFromManifest({
        projectId: ctx.projectId,
        organizationId: ctx.organizationId,
        name: change.name,
        resourceId: existingId,
        spec,
        env: resolved.values,
        // Synthesized by groupChanges when the diff for this service is env-only:
        // skip the field patch, run just the env reconcile (one container roll).
        envOnly: change.details?.envOnly === true,
        rollout: resolveRolloutTiming(ctx, change.name, spec.source, builds.length > 0),
        log: ctx.log,
      });
  // Enqueued here, with the update, for the same reason as a create's.
  const buildSkipped = await runGitBuilds(ctx, builds);
  const domainSkipped = await addMissingDomains(ctx, change.name, existingId, spec);
  return {
    updated,
    localSkipped: [...resolved.skipped, ...buildSkipped, ...domainSkipped],
    name: change.name,
  };
}

/** The diff for this service changed nothing but its domains. */
function domainsOnly(change: Change): boolean {
  const fields = change.details?.fields;
  const keys =
    fields && typeof fields === "object" && !Array.isArray(fields) ? Object.keys(fields) : [];
  return keys.length === 1 && keys[0] === "domains";
}

/**
 * Domains the manifest declares that the service does not serve yet, added
 * the way a create seeds them. Additive: a live domain the manifest does not
 * name is never removed here.
 */
async function addMissingDomains(
  ctx: ApplyContext,
  name: string,
  resourceId: ResourceId,
  spec: ServiceManifest,
): Promise<ManifestApplySkipError[]> {
  const current = ctx.current.services[name];
  const missing = current ? new Set(missingDomains(spec, current)) : new Set<string>();
  const domains = (spec.domains ?? []).filter((d) => missing.has(d.domain.toLowerCase()));
  if (domains.length === 0) return [];
  return seedServiceDomains({
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    resourceId,
    name,
    domains,
    log: ctx.log,
  });
}

/** The rollout a create/update started, if it started one. */
function startedRollout(
  name: string,
  outcome: Result<ServiceApplied, ManifestApplySkipError>,
): StartedRollout[] {
  if (outcome.isErr() || outcome.value.deploymentId === null) return [];
  return [{ name, resourceId: outcome.value.resourceId, deploymentId: outcome.value.deploymentId }];
}

async function hasPendingImage(resourceId: ResourceId): Promise<boolean> {
  const [svc] = await db
    .select({ image: serviceResource.image })
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, resourceId))
    .limit(1);
  return svc?.image.startsWith("pending:") === true;
}

/**
 * A service whose build runs as part of this deploy rolls with that build, not
 * before it: the apply enqueues one (a git service still on its placeholder
 * image), or the caller uploads its source right after (`otterdeploy deploy`).
 * Rolling the running image onto the new fields first is wasted at best; with
 * a changed port it is a rollout that can never pass, and the request waits
 * out its whole readiness window for it.
 */
function resolveRolloutTiming(
  ctx: ApplyContext,
  name: string,
  source: ServiceManifest["source"],
  buildEnqueued: boolean,
): RolloutTiming {
  if (buildEnqueued) return "with-build";
  if (source === "upload" && ctx.sourceUploads.has(name)) return "with-build";
  return "now";
}

export async function runServiceUpdates(
  ctx: ApplyContext,
  changes: Change[],
  refTable: RefTable,
): Promise<PhaseContribution> {
  const outcomes = await Promise.all(
    changes.map((change) => updateOneService(ctx, change, refTable)),
  );
  let applied = 0;
  const skipped: ManifestApplySkipError[] = [];
  const rollouts: StartedRollout[] = [];
  for (const o of outcomes) {
    if (!o) continue;
    skipped.push(...o.localSkipped);
    if (o.updated.isOk()) applied += 1;
    else skipped.push(o.updated.error);
    rollouts.push(...startedRollout(o.name, o.updated));
  }
  return { applied, skipped, rollouts };
}

/**
 * A git service whose first build never started: bound to a repo, still on
 * its placeholder image, and no deployment of any kind ever recorded.
 *
 * Read fresh: the apply that created it may have finished a moment ago.
 */
async function neverBuilt(resourceId: ResourceId): Promise<boolean> {
  const [row] = await db
    .select({ id: serviceResource.resourceId })
    .from(serviceResource)
    .where(
      and(
        eq(serviceResource.resourceId, resourceId),
        like(serviceResource.image, "pending:%"),
        isNotNull(serviceResource.gitRepoId),
        notExists(
          db
            .select({ id: deployment.id })
            .from(deployment)
            .where(eq(deployment.resourceId, resourceId)),
        ),
      ),
    )
    .limit(1)
    .$withCache(false);
  return row !== undefined;
}

/**
 * Git services this apply has no change for that were created and never
 * built, so the apply builds them.
 *
 * The create promised a build. If the apply that created one was cut short
 * before its build was enqueued (a crash, a restart), the service exists,
 * matches the manifest, and diffs as a no-op on every later apply: nothing
 * would ever build it again short of a manual Deploy. A service whose build
 * did start and failed has a deployment, and is left to the operator.
 */
export async function unbuiltGitServices(
  ctx: ApplyContext,
  noOpServiceNames: readonly string[],
): Promise<GitBuild[]> {
  const found = await Promise.all(
    noOpServiceNames.map(async (name): Promise<GitBuild | null> => {
      if (ctx.manifest.services[name]?.source !== "git") return null;
      const resourceId = await lookupServiceId(ctx.projectId, name, ctx.scope);
      if (!resourceId || !(await neverBuilt(resourceId))) return null;
      return { resourceId, name };
    }),
  );
  return found.filter((b): b is GitBuild => b !== null);
}
