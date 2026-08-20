/**
 * Project-wide deployment list: every base deployment across the project's
 * resources, newest first, with resource name/kind joined in.
 *
 * Status model (shares the vocabulary of `listResourceDeployments` but a
 * cheaper derivation, since this list spans many resources and polls):
 *
 *   1. Non-latest rows whose stored status never settled past
 *      running/building/pending read as `superseded`. A newer deploy
 *      replaced them. Terminal stored statuses (failed/removed/superseded)
 *      are kept as-is: a failed build stays visibly *failed* in the
 *      project-wide history (this feed exists to spot them), unlike the
 *      per-resource tab which collapses all non-latest rows to "replaced".
 *   2. The latest row per resource, when stored in-flight-or-live
 *      (pending/building/running), is refined against the live docker task
 *      states via the same `deriveDeploymentStatus` the per-resource list
 *      uses, so crash loops show `crashed` and fresh deploys show
 *      `starting`, and the lazy building→running reconcile still fires.
 *      Docker being unreachable degrades to the stored status, never a 500.
 *
 * Filtering/pagination happen in-process over the project's (narrow,
 * snapshot-free) deployment rows: per-resource "latest" needs a full pass
 * anyway, project deployment counts are modest, and it keeps exactly one
 * status-semantics implementation (`matchesStatusFilter`) shared with tests.
 */
import type {
  DeploymentId,
  EnvironmentId,
  OrganizationId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, environment, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, desc, eq, gte, isNull, type SQL } from "drizzle-orm";

import type { DeploymentRow } from "../project/deployments";
import type { DerivedDeploymentStatus } from "../project/deployments-list";

import {
  deriveDeploymentStatus,
  isBuildStillLogging,
  loadTaskStatesByDeployment,
  reconcileDeploySuccess,
  resolveDeploymentServiceName,
} from "../project/deployments-list";
import { ProjectNotFoundError } from "../project/errors";
import { getProjectInOrg } from "../project/queries";
import { getResourceById, inEnvironmentScope } from "../project/queries/resource";
import {
  computeStats,
  effectiveListedStatus,
  IN_FLIGHT_OR_LIVE,
  matchesQuery,
  matchesStatusFilter,
  type ProjectDeploymentStats,
  type ProjectDeploymentsStatusFilter,
} from "./list-filters";

export type ResourceKind = "database" | "service" | "compose";

export interface ProjectDeploymentItem {
  id: DeploymentId;
  projectId: ProjectId;
  resourceId: ResourceId;
  resourceName: string;
  resourceKind: ResourceKind;
  environmentName: string;
  image: string;
  reason: DeploymentRow["reason"];
  status: DerivedDeploymentStatus;
  errorMessage: string | null;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  gitCommitAuthorAvatar: string | null;
  sourceSha: string | null;
  isLatest: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListInput {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId?: ResourceId;
  status?: ProjectDeploymentsStatusFilter;
  environment?: { environmentId: EnvironmentId; isMain: boolean };
  q?: string;
  since?: Date;
  limit: number;
  offset: number;
}

interface JoinedRow {
  id: DeploymentId;
  resourceId: ResourceId;
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
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Refine the page's latest in-flight/live rows against live task states.
 * One docker instance-list per distinct resource (never per row). Returns a
 * map of deploymentId → derived status for the rows it could refine; anything
 * missing keeps its effective stored status. Also fires the lazy
 * building→running success reconcile, same as the per-resource list.
 */
async function refineLatestStatuses(
  projectId: ProjectId,
  page: (JoinedRow & { isLatest: boolean })[],
): Promise<Map<DeploymentId, DerivedDeploymentStatus>> {
  const refined = new Map<DeploymentId, DerivedDeploymentStatus>();
  const candidates = page.filter((r) => r.isLatest && IN_FLIGHT_OR_LIVE.has(r.status));
  for (const row of candidates) {
    try {
      // Kind-specific lookup; compose stacks (no single swarm service to
      // derive from) resolve a null service name and keep their stored status.
      const found = await getResourceById(projectId, row.resourceId);
      if (!found) continue;
      const serviceName = await resolveDeploymentServiceName(found, projectId);
      if (!serviceName) continue;
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
      );
      if (derived === "running" && (row.status === "building" || row.status === "pending")) {
        await reconcileDeploySuccess([row.id], row.resourceId);
      }
      refined.set(row.id, derived);
    } catch {
      // Docker unreachable / transient failure: show the stored status
      // rather than failing the whole page.
    }
  }
  return refined;
}

/** Display name for NULL-stamped rows: the project's own main environment.
 *  A project without a resolvable main environment (shouldn't happen, but
 *  the pointer is nullable) reads as "main" rather than blank. */
async function mainEnvironmentName(mainEnvId: EnvironmentId | null): Promise<string> {
  if (!mainEnvId) return "main";
  const [row] = await db
    .select({ name: environment.name })
    .from(environment)
    .where(eq(environment.id, mainEnvId))
    .limit(1);
  return row?.name ?? "main";
}

export async function listProjectDeployments(
  input: ListInput,
): Promise<
  Result<
    { items: ProjectDeploymentItem[]; total: number; stats: ProjectDeploymentStats },
    ProjectNotFoundError
  >
> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // Base rows only: preview deployments (and preview-scoped branched
  // resources) live on the preview panel, not the project feed. `snapshot`
  // (the full config jsonb) is deliberately not selected.
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
    // child rows stay reachable through their own resource (explicit
    // `resourceId` filter / the child service's Deployments tab).
    conditions.push(isNull(serviceResource.stackId));
  }
  if (input.environment) {
    // Same NULL-means-main scoping every resource read uses; this is what
    // makes the environment filter agree with the rest of the app.
    const scope = inEnvironmentScope(input.environment);
    if (scope) conditions.push(scope);
  }
  if (input.since) conditions.push(gte(deployment.createdAt, input.since));

  const rows: JoinedRow[] = await db
    .select({
      id: deployment.id,
      resourceId: deployment.resourceId,
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
      completedAt: deployment.completedAt,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    // Left join: only service resources have a service_resource row; databases
    // and compose stacks null out, which the stack-child filter above treats
    // as "not a child" (kept).
    .leftJoin(serviceResource, eq(serviceResource.resourceId, deployment.resourceId))
    // Left join: NULL-stamped resources (main environment) have no
    // environment row; their name resolves via mainEnvironmentName below.
    .leftJoin(environment, eq(environment.id, resource.environmentId))
    .where(and(...conditions))
    .orderBy(desc(deployment.createdAt), desc(deployment.id));

  // First row per resource in the desc ordering is that resource's newest.
  // (A `since` window can only hide a resource entirely, never its newest row
  // while showing older ones: max(createdAt) is in any window that has rows.)
  const latestByResource = new Map<ResourceId, DeploymentId>();
  for (const row of rows) {
    if (!latestByResource.has(row.resourceId)) latestByResource.set(row.resourceId, row.id);
  }

  const withLatest = rows.map((row) => ({
    ...row,
    isLatest: latestByResource.get(row.resourceId) === row.id,
  }));

  // Search narrows both the table and the stats; the status select narrows
  // only the table (see computeStats).
  const q = input.q;
  const searched = q ? withLatest.filter((row) => matchesQuery(row, q)) : withLatest;

  const stats = computeStats(searched);

  const statusFilter = input.status;
  const filtered = statusFilter
    ? searched.filter((row) => matchesStatusFilter(statusFilter, row.status, row.isLatest))
    : searched;

  const total = filtered.length;
  const page = filtered.slice(input.offset, input.offset + input.limit);

  const [refined, mainEnvName] = await Promise.all([
    refineLatestStatuses(input.projectId, page),
    mainEnvironmentName(project.environmentId),
  ]);

  const items: ProjectDeploymentItem[] = page.map((row) => ({
    id: row.id,
    projectId: input.projectId,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    resourceKind: row.resourceKind,
    environmentName: row.environmentName ?? mainEnvName,
    image: row.image,
    reason: row.reason,
    status: refined.get(row.id) ?? effectiveListedStatus(row.status, row.isLatest),
    errorMessage: row.errorMessage,
    gitSha: row.gitSha,
    gitRef: row.gitRef,
    gitCommitMessage: row.gitCommitMessage,
    gitCommitAuthor: row.gitCommitAuthor,
    gitCommitAuthorAvatar: row.gitCommitAuthorAvatar,
    sourceSha: row.sourceSha,
    isLatest: row.isLatest,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return Result.ok({ items, total, stats });
}
