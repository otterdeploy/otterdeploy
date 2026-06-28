/**
 * Service create/update phases of the manifest reconciler. Split from the rest
 * of the phases because each per-service step is heavier — env-ref resolution,
 * domain seeding on create, and the pending-build enqueue on update.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import type { ApplyContext, GitBuild, PhaseContribution } from "./manifest-apply-phases";

import { type Change } from "../../stack/manifest";
import { ManifestApplySkipError } from "./errors";
import { type RefTable, resolveEnv } from "./manifest-apply-refs";
import {
  createServiceFromManifest,
  seedServiceDomains,
  updateServiceFromManifest,
} from "./manifest-apply-services";
import { lookupServiceId } from "./manifest-apply-support";

interface ServiceCreateOutcome {
  created: Result<{ resourceId: ResourceId }, ManifestApplySkipError>;
  builds: GitBuild[];
  localSkipped: ManifestApplySkipError[];
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
    organizationId: ctx.organizationId,
    name: change.name,
    spec,
    env: resolved.values,
    log: ctx.log,
  });
  const builds: GitBuild[] = [];
  if (created.isOk() && spec.source === "git") {
    builds.push({ resourceId: created.value.resourceId, name: change.name });
  }
  // Seed manifest-declared public domains onto the freshly-created service
  // (create-time only). Failures are non-fatal skips — the service itself is
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
  return { created, builds, localSkipped };
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
  const gitBuilds: GitBuild[] = [];
  for (const o of outcomes) {
    if (!o) continue;
    skipped.push(...o.localSkipped);
    if (o.created.isOk()) applied += 1;
    else skipped.push(o.created.error);
    gitBuilds.push(...o.builds);
  }
  return { applied, skipped, gitBuilds };
}

interface ServiceUpdateOutcome {
  updated: Result<{ resourceId: ResourceId }, ManifestApplySkipError>;
  builds: GitBuild[];
  localSkipped: ManifestApplySkipError[];
}

async function updateOneService(
  ctx: ApplyContext,
  change: Change,
  refTable: RefTable,
): Promise<ServiceUpdateOutcome | null> {
  const spec = ctx.manifest.services[change.name];
  const existingId = await lookupServiceId(ctx.projectId, change.name);
  if (!spec || !existingId) return null;
  const resolved = resolveEnv(
    change.name,
    spec.env,
    refTable,
    ctx.current.services[change.name]?.env ?? {},
  );
  const updated = await updateServiceFromManifest({
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    name: change.name,
    resourceId: existingId,
    spec,
    env: resolved.values,
    log: ctx.log,
  });
  // A git service created but never successfully built sits on a `pending:*`
  // image with no deployment. Builds normally fire only on create (or git
  // push), so without this a "Deploy" on such a stuck service no-ops forever.
  const builds: GitBuild[] = [];
  if (spec.source === "git") {
    const [svc] = await db
      .select({ image: serviceResource.image })
      .from(serviceResource)
      .where(eq(serviceResource.resourceId, existingId))
      .limit(1);
    if (svc?.image.startsWith("pending:")) {
      builds.push({ resourceId: existingId, name: change.name });
    }
  }
  return { updated, builds, localSkipped: resolved.skipped };
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
  const gitBuilds: GitBuild[] = [];
  for (const o of outcomes) {
    if (!o) continue;
    skipped.push(...o.localSkipped);
    if (o.updated.isOk()) applied += 1;
    else skipped.push(o.updated.error);
    gitBuilds.push(...o.builds);
  }
  return { applied, skipped, gitBuilds };
}
