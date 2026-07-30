/**
 * Clone a set of resources within a project.
 *
 * Two entry points over one plan, because the interesting facts are known
 * BEFORE anything is created and are worth showing first:
 *
 *   preview — the names the copies will get, and every env reference that will
 *     still point at a resource outside the set. That second list is the one
 *     that matters: a cloned service holding `${{redis.URL}}` for a redis you
 *     didn't clone will read and write your production redis, happily, with no
 *     symptom. Showing it before the copy exists is the difference between a
 *     decision and a discovery.
 *
 *   execute — do it.
 *
 * The plan is computed identically for both, so the preview cannot promise
 * something the execution won't deliver.
 */

import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { serviceEnvVar } from "@otterdeploy/db/schema/project";
import { Result, TaggedError } from "better-result";
import { eq, inArray } from "drizzle-orm";

import { getProjectInOrg } from "../queries";
import { type CloneOutcome, executeClone } from "./execute";
import { type CloneSource, type ClonePlan, planClone } from "./plan";

class CloneProjectNotFoundError extends TaggedError("CloneProjectNotFoundError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "project not found" });
  }
}

class CloneEmptySelectionError extends TaggedError("CloneEmptySelectionError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "select at least one resource to clone" });
  }
}

export interface CloneInput {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceIds: string[];
}

type CloneError = CloneProjectNotFoundError | CloneEmptySelectionError;

/**
 * Build the plan. Shared by preview and execute so the two can't diverge.
 *
 * Selection is filtered against the project's OWN resources rather than
 * trusted: a resource id from another project would otherwise be copied across
 * a tenant boundary by a caller who simply passed the wrong id.
 */
async function buildPlan(
  input: CloneInput,
): Promise<Result<{ plan: ClonePlan; projectSlug: string }, CloneError>> {
  if (input.resourceIds.length === 0) {
    return Result.err(new CloneEmptySelectionError());
  }

  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) return Result.err(new CloneProjectNotFoundError());

  const all = await db
    .select({ id: resource.id, name: resource.name, type: resource.type })
    .from(resource)
    .where(eq(resource.projectId, input.projectId));

  const selected = new Set(input.resourceIds);
  const sources: CloneSource[] = all
    .filter((r) => selected.has(r.id))
    .map((r) => ({
      resourceId: r.id,
      name: r.name,
      type: r.type as CloneSource["type"],
    }));

  // Env values are needed to find refs that will reach outside the set. Only
  // services carry them; a database's config holds no refs.
  const envRows = sources.length
    ? await db
        .select({
          resourceId: serviceEnvVar.serviceResourceId,
          key: serviceEnvVar.key,
          value: serviceEnvVar.value,
        })
        .from(serviceEnvVar)
        .where(
          inArray(
            serviceEnvVar.serviceResourceId,
            sources.map((s) => s.resourceId) as ResourceId[],
          ),
        )
    : [];

  const envBySource = new Map<string, Record<string, string>>();
  for (const row of envRows) {
    const bag = envBySource.get(row.resourceId) ?? {};
    bag[row.key] = row.value;
    envBySource.set(row.resourceId, bag);
  }

  return Result.ok({
    plan: planClone(
      sources,
      all.map((r) => r.name),
      envBySource,
    ),
    projectSlug: project.slug,
  });
}

export interface ClonePreview {
  names: { sourceName: string; targetName: string }[];
  /** Refs that will keep pointing at resources you are NOT cloning. */
  externalRefs: { fromName: string; toName: string; envKey: string }[];
}

export async function previewClone(input: CloneInput): Promise<Result<ClonePreview, CloneError>> {
  const built = await buildPlan(input);
  if (built.isErr()) return Result.err(built.error);
  const { plan } = built.value;
  return Result.ok({
    names: plan.items.map((i) => ({ sourceName: i.sourceName, targetName: i.targetName })),
    externalRefs: plan.externalRefs,
  });
}

export async function cloneResources(
  input: CloneInput,
  log: RequestLogger,
): Promise<Result<CloneOutcome & { externalRefs: ClonePreview["externalRefs"] }, CloneError>> {
  const built = await buildPlan(input);
  if (built.isErr()) return Result.err(built.error);
  const { plan, projectSlug } = built.value;

  const outcome = await executeClone(plan, { projectId: input.projectId, projectSlug }, log);
  // The warning travels with the result too, not just the preview — a caller
  // that skipped the preview still has to be told what its copies point at.
  return Result.ok({ ...outcome, externalRefs: plan.externalRefs });
}
