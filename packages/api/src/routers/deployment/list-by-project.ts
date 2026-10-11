/**
 * Project-wide deployment list: every base deployment across the project's
 * resources, newest first, with resource name/kind joined in.
 *
 * Status model (shares the vocabulary of `listResourceDeployments` but a
 * cheaper derivation, since this list spans many resources and polls):
 *
 *   1. Each resource's newest row, when stored in-flight-or-live, is refined
 *      against the live docker task states via the same
 *      `deriveDeploymentStatus` the per-resource list uses, so crash loops
 *      show `crashed`, fresh deploys show `starting`, and the lazy
 *      building→running reconcile still fires.
 *   2. The deployment each resource is SERVING is resolved from that (see
 *      `resolveServing`): the newest row once it has come up, otherwise the
 *      newest stored-running row. It is marked `isServing` and keeps its
 *      `running` status even with a newer deploy in flight above it.
 *   3. Older rows that never settled read as `superseded`; terminal outcomes
 *      (failed/cancelled/removed) are kept as-is.
 *
 * Rows, the status filter and the summary counts all read that one listed
 * status (`listedStatus`), so the summary can never contradict a row.
 *
 * Filtering/pagination happen in-process over the project's (narrow,
 * snapshot-free) deployment rows: per-resource "latest" needs a full pass
 * anyway, and project deployment counts are modest.
 */
import type {
  DeploymentId,
  EnvironmentId,
  OrganizationId,
  PreviewId,
  ProjectId,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, environment } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq, gte } from "drizzle-orm";

import type { DeploymentActor, DeploymentRow } from "../project/deployments";
import type { DerivedDeploymentStatus } from "../project/deployments-list";

import { ProjectNotFoundError } from "../project/errors";
import { getProjectInOrg } from "../project/queries";
import {
  actorInput,
  type JoinedRow,
  refineLatestStatuses,
  type ResourceKind,
  scopeConditions,
  selectJoinedRows,
} from "./list-by-project-rows";
import {
  computeStats,
  listedStatus,
  matchesPeople,
  matchesQuery,
  matchesStatusFilter,
  peopleFacets,
  type PeopleFacets,
  type PeopleFilter,
  type ProjectDeploymentStats,
  type ProjectDeploymentsStatusFilter,
  resolveServing,
} from "./list-filters";

export interface ProjectDeploymentItem {
  id: DeploymentId;
  projectId: ProjectId;
  resourceId: ResourceId;
  /** Always null here: this listing filters to base rows. Present so the item
   *  satisfies the shared deployment schema. */
  previewId: PreviewId | null;
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
  triggeredBy: DeploymentActor | null;
  isLatest: boolean;
  isServing: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What one resource is serving, whether or not that deploy is in the window. */
export interface ServingDeployment {
  resourceId: ResourceId;
  deploymentId: DeploymentId;
  gitSha: string | null;
  sourceSha: string | null;
  image: string;
  /** When it finished rolling out; null for old rows that never recorded it. */
  completedAt: string | null;
  createdAt: string;
}

interface ListInput {
  projectId: ProjectId;
  organizationId: OrganizationId;
  resourceId?: ResourceId;
  status?: ProjectDeploymentsStatusFilter;
  environment?: { environmentId: EnvironmentId; isMain: boolean };
  q?: string;
  people?: PeopleFilter;
  since?: Date;
  limit: number;
  offset: number;
}

type ListedRow = JoinedRow & {
  isLatest: boolean;
  isServing: boolean;
  listed: DerivedDeploymentStatus;
};

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

/** The rows in the window with their listed status and serving flag, plus
 *  what every resource in scope is serving (in the window or not). */
async function loadListedRows(input: ListInput): Promise<{
  rows: ListedRow[];
  serving: ServingDeployment[];
}> {
  const scope = scopeConditions(input);
  const rows = await selectJoinedRows(
    input.since ? [...scope, gte(deployment.createdAt, input.since)] : scope,
  );
  // What a resource serves can predate the window, so it is read across all
  // time: the newest stored-running row per resource.
  const runningRows = await selectJoinedRows([...scope, eq(deployment.status, "running")]);
  const newestRunning = new Map<ResourceId, JoinedRow>();
  for (const row of runningRows) {
    if (row.status === "running" && !newestRunning.has(row.resourceId)) {
      newestRunning.set(row.resourceId, row);
    }
  }

  // First row per resource in the desc ordering is that resource's newest.
  // (A `since` window can only hide a resource entirely, never its newest row
  // while showing older ones: max(createdAt) is in any window that has rows.)
  const latest = new Map<ResourceId, JoinedRow>();
  for (const row of rows) if (!latest.has(row.resourceId)) latest.set(row.resourceId, row);

  const derived = await refineLatestStatuses(input.projectId, [...latest.values()]);
  const servingIds = resolveServing(
    [...latest.values()].map((r) => ({
      id: r.id,
      resourceId: r.resourceId,
      stored: r.status,
      derived: derived.get(r.id),
    })),
    new Map([...newestRunning].map(([resourceId, r]) => [resourceId, r.id])),
  );
  const servingSet = new Set(servingIds.values());

  const listed = rows.map((row) => {
    const isLatest = latest.get(row.resourceId)?.id === row.id;
    const isServing = servingSet.has(row.id);
    return {
      ...row,
      isLatest,
      isServing,
      listed: listedStatus({ status: row.status, isLatest, isServing }, derived.get(row.id)),
    };
  });

  const byId = new Map<DeploymentId, JoinedRow>([
    ...[...newestRunning.values()].map((r) => [r.id, r] as const),
    ...rows.map((r) => [r.id, r] as const),
  ]);
  const serving = [...servingIds].flatMap(([resourceId, id]) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        resourceId,
        deploymentId: id,
        gitSha: row.gitSha,
        sourceSha: row.sourceSha,
        image: row.image,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      },
    ];
  });
  return { rows: listed, serving };
}

function toItem(row: ListedRow, projectId: ProjectId, mainEnvName: string): ProjectDeploymentItem {
  return {
    id: row.id,
    projectId,
    resourceId: row.resourceId,
    previewId: row.previewId,
    resourceName: row.resourceName,
    resourceKind: row.resourceKind,
    environmentName: row.environmentName ?? mainEnvName,
    image: row.image,
    reason: row.reason,
    status: row.listed,
    errorMessage: row.errorMessage,
    gitSha: row.gitSha,
    gitRef: row.gitRef,
    gitCommitMessage: row.gitCommitMessage,
    gitCommitAuthor: row.gitCommitAuthor,
    gitCommitAuthorAvatar: row.gitCommitAuthorAvatar,
    sourceSha: row.sourceSha,
    triggeredBy: actorInput(row).triggeredBy,
    isLatest: row.isLatest,
    isServing: row.isServing,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProjectDeployments(input: ListInput): Promise<
  Result<
    {
      items: ProjectDeploymentItem[];
      total: number;
      stats: ProjectDeploymentStats;
      serving: ServingDeployment[];
      facets: PeopleFacets;
    },
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

  const { rows, serving } = await loadListedRows(input);

  // Search and the person filter narrow both the list and the summary; the
  // status filter narrows only the list (see computeStats). The person
  // options are read before the person filter, so picking one never hides
  // the others.
  const q = input.q;
  const searched = q ? rows.filter((row) => matchesQuery(row, q)) : rows;
  const facets = peopleFacets(searched.map(actorInput));
  const people = input.people;
  const scoped = people
    ? searched.filter((row) => matchesPeople(actorInput(row), people))
    : searched;

  const stats = computeStats(scoped.map((row) => ({ ...row, status: row.listed })));

  const statusFilter = input.status;
  const filtered = statusFilter
    ? scoped.filter((row) =>
        matchesStatusFilter(statusFilter, { status: row.listed, isServing: row.isServing }),
      )
    : scoped;

  const page = filtered.slice(input.offset, input.offset + input.limit);
  const mainEnvName = await mainEnvironmentName(project.environmentId);
  const items = page.map((row) => toItem(row, input.projectId, mainEnvName));

  return Result.ok({ items, total: filtered.length, stats, serving, facets });
}
