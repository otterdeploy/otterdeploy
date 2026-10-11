import type { DeployActorInput } from "@otterdeploy/shared/deploy-status";
/**
 * The reads behind the project-wide deployments list: the joined rows, and the
 * live-task refinement of each resource's newest row. Split from
 * ./list-by-project.ts (which assembles the response) to keep both files inside
 * the size cap.
 */
import type {
  DeploymentId,
  EnvironmentId,
  PreviewId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { user } from "@otterdeploy/db/schema/auth";
import { deployment, environment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import type { DeploymentRow } from "../project/deployments";
import type { DerivedDeploymentStatus } from "../project/deployments-list";

import {
  deriveDeploymentStatus,
  isBuildStillLogging,
  loadTaskStatesByDeployment,
  resolveDeploymentServiceName,
} from "../project/deployments-list";
import { isOwnedInFlight, reconcileObservedSuccess } from "../project/deployments-reconcile";
import { getResourceById, inEnvironmentScope } from "../project/queries/resource";
import { IN_FLIGHT_OR_LIVE } from "./list-filters";

export type ResourceKind = "database" | "service" | "compose";

export interface JoinedRow {
  id: DeploymentId;
  resourceId: ResourceId;
  /** Always null here: this listing filters to base rows. Carried anyway so
   *  the row satisfies the shared deployment schema. */
  previewId: PreviewId | null;
  resourceName: string;
  resourceKind: ResourceKind;
  /** Joined environment name; null = NULL-stamped row (main environment). */
  environmentName: string | null;
  image: string;
  reason: DeploymentRow["reason"];
  status: DeploymentRow["status"];
  errorMessage: string | null;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
  sourceSha: string | null;
  actorName: string | null;
  actorImage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The scope every read of the list shares: the project's base rows, one
 *  resource or the whole feed (minus compose stack children), one environment
 *  or all of them. The time window is NOT part of it: what a resource is
 *  serving does not depend on which window is being looked at. */
export function scopeConditions(input: {
  projectId: ProjectId;
  resourceId?: ResourceId;
  environment?: { environmentId: EnvironmentId; isMain: boolean };
}): SQL[] {
  // Base rows only: preview deployments (and preview-scoped branched
  // resources) live on the preview panel, not the project feed.
  const conditions: SQL[] = [
    eq(resource.projectId, input.projectId),
    isNull(deployment.previewId),
    isNull(resource.previewId),
  ];
  if (input.resourceId) conditions.push(eq(deployment.resourceId, input.resourceId));
  else {
    // Project-wide feed: hide compose stack CHILDREN. One stack deploy writes
    // a stack-level row (the rollout as a unit) plus a per-service row per
    // child, showing both duplicates every stack deploy in the ledger. The
    // child rows stay reachable through their own resource.
    conditions.push(isNull(serviceResource.stackId));
  }
  if (input.environment) {
    // Same NULL-means-main scoping every resource read uses.
    const scope = inEnvironmentScope(input.environment);
    if (scope) conditions.push(scope);
  }
  return conditions;
}

/** Newest first. `snapshot` (the full config jsonb) is deliberately not
 *  selected: this list spans many resources and polls. */
export function selectJoinedRows(conditions: SQL[]): Promise<JoinedRow[]> {
  return (
    db
      .select({
        id: deployment.id,
        resourceId: deployment.resourceId,
        previewId: deployment.previewId,
        resourceName: resource.name,
        resourceKind: resource.type,
        environmentName: environment.name,
        image: deployment.image,
        reason: deployment.reason,
        status: deployment.status,
        errorMessage: deployment.errorMessage,
        gitSha: deployment.gitSha,
        gitRef: deployment.gitRef,
        gitCommitMessage: deployment.gitCommitMessage,
        gitCommitAuthor: deployment.gitCommitAuthor,
        gitCommitAuthorAvatar: deployment.gitCommitAuthorAvatar,
        sourceSha: deployment.sourceSha,
        actorName: user.name,
        actorImage: user.image,
        completedAt: deployment.completedAt,
        createdAt: deployment.createdAt,
        updatedAt: deployment.updatedAt,
      })
      .from(deployment)
      .innerJoin(resource, eq(resource.id, deployment.resourceId))
      // Only service resources have a service_resource row; databases and
      // compose stacks null out, which the stack-child filter treats as kept.
      .leftJoin(serviceResource, eq(serviceResource.resourceId, deployment.resourceId))
      // NULL-stamped resources (main environment) have no environment row.
      .leftJoin(environment, eq(environment.id, resource.environmentId))
      // Most deployments have no person behind them (a push, a key).
      .leftJoin(user, eq(user.id, deployment.triggeredByUserId))
      .where(and(...conditions))
      .orderBy(desc(deployment.createdAt), desc(deployment.id))
  );
}

/** The fields `deployActor` credits a row from. */
export function actorInput(row: JoinedRow): DeployActorInput {
  return {
    reason: row.reason,
    triggeredBy:
      row.actorName === null ? null : { name: row.actorName, image: row.actorImage ?? null },
    gitCommitAuthor: row.gitCommitAuthor,
    gitCommitAuthorAvatar: row.gitCommitAuthorAvatar,
  };
}

/** One resource's newest row, against its live task states. Undefined when
 *  there is nothing to derive from (compose stacks have no single service) or
 *  docker could not be read: the stored status then stands. */
async function refineOne(
  projectId: ProjectId,
  row: JoinedRow,
): Promise<DerivedDeploymentStatus | undefined> {
  const found = await getResourceById(projectId, row.resourceId);
  if (!found) return undefined;
  const serviceName = await resolveDeploymentServiceName(found, projectId);
  if (!serviceName) return undefined;
  const tasks = await loadTaskStatesByDeployment(serviceName);
  const buildActive = await isBuildStillLogging(row, tasks);
  const paused = found.kind === "service" && found.record.service.pausedReplicas != null;
  const derived = deriveDeploymentStatus(
    row.status,
    true,
    tasks.get(row.id) ?? [],
    row.createdAt,
    buildActive,
    paused,
    await isOwnedInFlight(row),
  );
  // The lazy building→running success reconcile, same as the per-resource list.
  if (derived === "running" && (row.status === "building" || row.status === "pending")) {
    await reconcileObservedSuccess([row.id], row.resourceId);
  }
  return derived;
}

/**
 * Refine every resource's newest in-flight-or-live row against live task
 * states: one docker instance-list per resource, never per row. Every newest
 * row, not just the ones on the requested page: the counts, the status filter
 * and the serving determination all read these statuses, and a count computed
 * from a different status than the row shows is how the page contradicted
 * itself. Docker being unreachable degrades to the stored status, never a 500.
 */
export async function refineLatestStatuses(
  projectId: ProjectId,
  latest: ReadonlyArray<JoinedRow>,
): Promise<Map<DeploymentId, DerivedDeploymentStatus>> {
  const candidates = latest.filter((r) => IN_FLIGHT_OR_LIVE.has(r.status));
  const results = await Promise.all(
    candidates.map(async (row) => {
      const derived = await Result.tryPromise({
        try: () => refineOne(projectId, row),
        catch: (cause) => cause,
      });
      return [row.id, derived.isOk() ? derived.value : undefined] as const;
    }),
  );
  const refined = new Map<DeploymentId, DerivedDeploymentStatus>();
  for (const [id, derived] of results) if (derived) refined.set(id, derived);
  return refined;
}
