/**
 * Project-wide deployment list — every base deployment across the project's
 * resources, newest first, with resource name/kind joined in.
 *
 * Status model (shares the vocabulary of `listResourceDeployments` but a
 * cheaper derivation, since this list spans many resources and polls):
 *
 *   1. Non-latest rows whose stored status never settled past
 *      running/building/pending read as `superseded` — a newer deploy
 *      replaced them. Terminal stored statuses (failed/removed/superseded)
 *      are kept as-is: a failed build stays visibly *failed* in the
 *      project-wide history (this feed exists to spot them), unlike the
 *      per-resource tab which collapses all non-latest rows to "replaced".
 *   2. The latest row per resource, when stored in-flight-or-live
 *      (pending/building/running), is refined against the live docker task
 *      states via the same `deriveDeploymentStatus` the per-resource list
 *      uses — so crash loops show `crashed` and fresh deploys show
 *      `starting`, and the lazy building→running reconcile still fires.
 *      Docker being unreachable degrades to the stored status, never a 500.
 *
 * Filtering/pagination happen in-process over the project's (narrow,
 * snapshot-free) deployment rows: per-resource "latest" needs a full pass
 * anyway, project deployment counts are modest, and it keeps exactly one
 * status-semantics implementation (`matchesStatusFilter`) shared with tests.
 */
import type { DeploymentId, OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, resource } from "@otterdeploy/db/schema/project";
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
import { getResourceById } from "../project/queries/resource";

export type ProjectDeploymentsStatusFilter =
  | "building"
  | "running"
  | "failed"
  | "superseded"
  | "removed";

export type ResourceKind = "database" | "service" | "compose";

export interface ProjectDeploymentItem {
  id: DeploymentId;
  projectId: ProjectId;
  resourceId: ResourceId;
  resourceName: string;
  resourceKind: ResourceKind;
  image: string;
  reason: DeploymentRow["reason"];
  status: DerivedDeploymentStatus;
  errorMessage: string | null;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  isLatest: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Stored statuses that mean "this row was (or still is) the live/in-flight
 *  one" — the states a NEWER deploy invalidates into `superseded`. */
const IN_FLIGHT_OR_LIVE: ReadonlySet<DeploymentRow["status"]> = new Set([
  "pending",
  "building",
  "running",
]);

/**
 * Status as the project-wide list shows it, before any docker refinement.
 * Non-latest rows that never settled (running/building/pending) were replaced
 * by a newer deploy → `superseded`; everything else keeps its stored status.
 */
export function effectiveListedStatus(
  stored: DeploymentRow["status"],
  isLatest: boolean,
): DeploymentRow["status"] {
  if (!isLatest && IN_FLIGHT_OR_LIVE.has(stored)) return "superseded";
  return stored;
}

/** Does a row match the effective-status filter? `building` covers stored
 *  `pending` too (both render as in-flight). Single source of truth for the
 *  filter semantics — used by the list and unit-tested directly. */
export function matchesStatusFilter(
  filter: ProjectDeploymentsStatusFilter,
  stored: DeploymentRow["status"],
  isLatest: boolean,
): boolean {
  const effective = effectiveListedStatus(stored, isLatest);
  if (filter === "building") return effective === "building" || effective === "pending";
  return effective === filter;
}

interface ListInput {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId?: ResourceId;
  status?: ProjectDeploymentsStatusFilter;
  since?: Date;
  limit: number;
}

interface JoinedRow {
  id: DeploymentId;
  resourceId: ResourceId;
  resourceName: string;
  resourceKind: ResourceKind;
  image: string;
  reason: DeploymentRow["reason"];
  status: DeploymentRow["status"];
  errorMessage: string | null;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Refine the page's latest in-flight/live rows against live task states —
 * one docker instance-list per distinct resource (never per row). Returns a
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
      // derive from) return null and keep their stored status.
      const found = await getResourceById(projectId, row.resourceId);
      if (!found) continue;
      const serviceName = await resolveDeploymentServiceName(found, projectId);
      const tasks = await loadTaskStatesByDeployment(serviceName);
      const buildActive = await isBuildStillLogging(row, tasks);
      const derived = deriveDeploymentStatus(
        row.status,
        true,
        tasks.get(row.id) ?? [],
        row.createdAt,
        buildActive,
      );
      if (derived === "running" && (row.status === "building" || row.status === "pending")) {
        await reconcileDeploySuccess([row.id], row.resourceId);
      }
      refined.set(row.id, derived);
    } catch {
      // Docker unreachable / transient failure — show the stored status
      // rather than failing the whole page.
    }
  }
  return refined;
}

export async function listProjectDeployments(
  input: ListInput,
): Promise<Result<{ items: ProjectDeploymentItem[]; total: number }, ProjectNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // Base rows only — preview deployments (and preview-scoped branched
  // resources) live on the preview panel, not the project feed. `snapshot`
  // (the full config jsonb) is deliberately not selected.
  const conditions: SQL[] = [
    eq(resource.projectId, input.projectId),
    isNull(deployment.previewId),
    isNull(resource.previewId),
  ];
  if (input.resourceId) conditions.push(eq(deployment.resourceId, input.resourceId));
  if (input.since) conditions.push(gte(deployment.createdAt, input.since));

  const rows = (await db
    .select({
      id: deployment.id,
      resourceId: deployment.resourceId,
      resourceName: resource.name,
      resourceKind: resource.type,
      image: deployment.image,
      reason: deployment.reason,
      status: deployment.status,
      errorMessage: deployment.errorMessage,
      gitSha: deployment.gitSha,
      gitRef: deployment.gitRef,
      gitCommitMessage: deployment.gitCommitMessage,
      gitCommitAuthor: deployment.gitCommitAuthor,
      completedAt: deployment.completedAt,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .where(and(...conditions))
    .orderBy(desc(deployment.createdAt), desc(deployment.id))) as JoinedRow[];

  // First row per resource in the desc ordering is that resource's newest.
  // (A `since` window can only hide a resource entirely, never its newest row
  // while showing older ones — max(createdAt) is in any window that has rows.)
  const latestByResource = new Map<ResourceId, DeploymentId>();
  for (const row of rows) {
    if (!latestByResource.has(row.resourceId)) latestByResource.set(row.resourceId, row.id);
  }

  const withLatest = rows.map((row) => ({
    ...row,
    isLatest: latestByResource.get(row.resourceId) === row.id,
  }));

  const statusFilter = input.status;
  const filtered = statusFilter
    ? withLatest.filter((row) => matchesStatusFilter(statusFilter, row.status, row.isLatest))
    : withLatest;

  const total = filtered.length;
  const page = filtered.slice(0, input.limit);

  const refined = await refineLatestStatuses(input.projectId, page);

  const items: ProjectDeploymentItem[] = page.map((row) => ({
    id: row.id,
    projectId: input.projectId,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    resourceKind: row.resourceKind,
    image: row.image,
    reason: row.reason,
    status: refined.get(row.id) ?? effectiveListedStatus(row.status, row.isLatest),
    errorMessage: row.errorMessage,
    gitSha: row.gitSha,
    gitRef: row.gitRef,
    gitCommitMessage: row.gitCommitMessage,
    gitCommitAuthor: row.gitCommitAuthor,
    isLatest: row.isLatest,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return Result.ok({ items, total });
}
