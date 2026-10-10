/**
 * Org-wide build activity. What is queued or building right now, across every
 * project in the organization.
 *
 * This exists because the app-status rollup (apps/web/src/shared/lib/app-status.ts)
 * is PROJECT-scoped: `useProjectDeployStatus` only reports while you are inside
 * a project route, so the header could never answer "is anything building
 * anywhere?": the question an operator actually asks. This endpoint answers it
 * from one query instead of N project polls.
 *
 * Deliberately narrow: the two in-flight statuses, enough joined context to name
 * and link each row, and nothing else. It polls, so every extra column is paid
 * for on a timer. History belongs to `listByProject`; this is only the present.
 */

import type {
  DeploymentId,
  OrganizationId,
  ProjectId,
  ProjectSlug,
  ResourceId,
} from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  deployment,
  project,
  resource,
  serviceResource,
  environment,
} from "@otterdeploy/db/schema/project";
import { deployQueueName, listDeployLanes, runOnRequestQueue } from "@otterdeploy/jobs";
import { collectInFlightDeploys } from "@otterdeploy/jobs/in-flight-core";
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";

/**
 * Past this age an in-flight row MAY be stranded, not working.
 *
 * Mirrors `HELPER_TIMEOUT_MS` in apps/builder/src/handler.ts (and the client's
 * `STRANDED_AFTER_MS` in use-deploy-status.ts): the builder kills its helper at
 * that wall, so nothing alive can still be building beyond it. A row left
 * `pending`/`building` past that point is one whose helper died without
 * repairing it: real, and the reason the indicator needs a ceiling. Without one
 * a single stranded row pins the header pill on forever, and an always-on
 * indicator is furniture you learn to ignore.
 *
 * But the wall runs from when the BUILD starts, and this age is measured from
 * when the ROW was created. Behind a busy builder a deploy can wait in the
 * queue longer than that and then build for real. Such a row is still owned
 * by a live queue job, so an old row counts while a job owns it and only an
 * unowned one is stranded. Without that check the header under-counted every
 * long queue: fewer deploys in flight than were actually queued.
 */
const STRANDED_AFTER_MS = 45 * 60_000;

/** Nothing waits in a build queue this long; rows older than this are not read at all. */
const QUEUE_CEILING_MS = 24 * 60 * 60_000;

/** The two stored statuses that mean "work is owed". `running` is already live,
 *  `starting` never reaches the row (it is derived at render time). */
const IN_FLIGHT = ["pending", "building"] as const;

/** `project.slug` is plain text in the schema; the brand is applied at this
 *  read boundary by parsing, the same way route/form boundaries brand slugs. */
const projectSlugSchema = zSlug(ID_PREFIX.project);

export interface DeployActivityItem {
  id: DeploymentId;
  resourceId: ResourceId;
  resourceName: string;
  projectId: ProjectId;
  projectSlug: ProjectSlug;
  projectName: string;
  /** Environment slug, or null for the project's main environment. The header
   *  spans every environment, so a row's link must switch environment too. */
  environmentSlug: string | null;
  /** `pending` = waiting for the builder to pick it up; `building` = in progress. */
  status: "pending" | "building";
  reason: string;
  gitRef: string | null;
  createdAt: string;
}

export interface DeployLaneActivity {
  lane: string;
  /** Jobs a builder on this lane is processing right now. */
  active: number;
  /** Jobs sitting on this lane's queue (waiting/delayed/paused). */
  queued: number;
}

export interface DeployActivity {
  /** Oldest first: the queue reads top-to-bottom in the order it will drain. */
  items: DeployActivityItem[];
  building: number;
  queued: number;
  /**
   * Queued work with nothing consuming it: every builder is down or wedged.
   *
   * This is the signal a bare count cannot give you: "3 queued" is normal
   * behind an active build and alarming behind nothing. Same discriminator the
   * stale-build watchdog uses (packages/jobs/src/in-flight.ts), unioned over
   * every deploy lane.
   */
  builderStalled: boolean;
  /** Per-lane queue occupancy; single-lane installs see just "default".
   *  Omitted when the queue backend can't be read. */
  lanes?: DeployLaneActivity[];
}

/**
 * Queue occupancy per deploy lane, and whether ANY lane's worker is active.
 *
 * Fails CLOSED (`anyActive: true`, no lanes) when Redis can't be reached: an
 * unreachable queue means we don't know, and guessing "stalled" would light a
 * warning on every transient blip. The watchdog is what catches a genuinely
 * dead builder; this flag only has to avoid crying wolf.
 */
async function laneQueueStats(): Promise<{ anyActive: boolean; lanes?: DeployLaneActivity[] }> {
  try {
    const laneNames = await listDeployLanes();
    const lanes = await Promise.all(
      laneNames.map(async (lane): Promise<DeployLaneActivity> => {
        // Fail-fast request queue: Redis down lands in the catch below within
        // QUEUE_READY_TIMEOUT_MS instead of holding the activity feed.
        const counts = await runOnRequestQueue(deployQueueName(lane), (queue) =>
          queue.getJobCounts("active", "waiting", "delayed", "paused"),
        );
        return {
          lane,
          active: counts.active ?? 0,
          queued: (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.paused ?? 0),
        };
      }),
    );
    return { anyActive: lanes.some((l) => l.active > 0), lanes };
  } catch {
    return { anyActive: true };
  }
}

/**
 * Deployment ids a queued, active, delayed or paused deploy job owns, across
 * every lane. Fail-fast request queues: when Redis cannot answer, null, and
 * the caller treats every old row as stranded (the behaviour before the check).
 */
async function ownedDeploymentIds(): Promise<ReadonlySet<string> | null> {
  const owned = await Result.tryPromise({
    try: async () => {
      const lanes = await listDeployLanes();
      const perLane = await Promise.all(
        lanes.map((lane) =>
          runOnRequestQueue(deployQueueName(lane), (queue) => collectInFlightDeploys([queue])),
        ),
      );
      return new Set(perLane.flatMap((lane) => [...lane.ownedIds]));
    },
    catch: (cause) => cause,
  });
  return owned.isOk() ? owned.value : null;
}

export interface DeployActivityDeps {
  ownedDeploymentIds: () => Promise<ReadonlySet<string> | null>;
}

export async function getDeployActivity(
  input: {
    organizationId: OrganizationId;
    limit: number;
  },
  deps: DeployActivityDeps = { ownedDeploymentIds },
): Promise<DeployActivity> {
  const inFlight = await db
    .select({
      id: deployment.id,
      resourceId: deployment.resourceId,
      resourceName: resource.name,
      projectId: project.id,
      projectSlug: project.slug,
      projectName: project.name,
      // Left join: a resource predating environments has no stamp and belongs
      // to main, which the UI represents by omitting `?env=`.
      environmentSlug: environment.slug,
      status: deployment.status,
      reason: deployment.reason,
      gitRef: deployment.gitRef,
      createdAt: deployment.createdAt,
    })
    .from(deployment)
    .innerJoin(resource, eq(resource.id, deployment.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .leftJoin(environment, eq(environment.id, resource.environmentId))
    // Left join: only service resources have a service_resource row. Databases
    // and compose stacks null out, which the stack-child filter below keeps.
    .leftJoin(serviceResource, eq(serviceResource.resourceId, deployment.resourceId))
    .where(
      and(
        eq(project.organizationId, input.organizationId),
        inArray(deployment.status, [...IN_FLIGHT]),
        // Only a bound: the stranded rule needs the queue (below).
        gte(deployment.createdAt, new Date(Date.now() - QUEUE_CEILING_MS)),
        // Preview deploys belong to their PR panel, not the workspace header.
        isNull(deployment.previewId),
        isNull(resource.previewId),
        // One compose deploy writes a stack-level row PLUS a row per child
        // service. Counting both would report a 3-service stack as 4 queued
        // builds. The stack row is the honest unit of work here.
        isNull(serviceResource.stackId),
      ),
    )
    // Oldest first: this is a queue, and the useful reading order is the order
    // it drains, not newest-first like the history feed.
    .orderBy(asc(deployment.createdAt), asc(deployment.id));

  // A row past the stranded age counts only while a queue job still owns it.
  // The queue is read only when such a row exists: the common poll stays one
  // query. Ageing out before counting keeps stranded rows from consuming the
  // limit and hiding real work behind them.
  const strandedBefore = Date.now() - STRANDED_AFTER_MS;
  const old = inFlight.filter((row) => row.createdAt.getTime() < strandedBefore);
  const owned = old.length > 0 ? await deps.ownedDeploymentIds() : null;
  const rows = inFlight.filter(
    (row) => row.createdAt.getTime() >= strandedBefore || owned?.has(row.id) === true,
  );

  let building = 0;
  let queued = 0;
  for (const row of rows) {
    if (row.status === "building") building += 1;
    else queued += 1;
  }

  // Counts come from the full result, the list from the page, so the pill
  // stays truthful ("12 queued") even when the popover shows the first 20.
  const items: DeployActivityItem[] = rows.slice(0, input.limit).map((row) => ({
    id: row.id,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    projectId: row.projectId,
    projectSlug: projectSlugSchema.parse(row.projectSlug),
    projectName: row.projectName,
    environmentSlug: row.environmentSlug,
    // Narrowed by the inArray(IN_FLIGHT) filter above; the ternary keeps the
    // narrowing honest without asserting over drizzle's wider status enum.
    status: row.status === "building" ? "building" : "pending",
    reason: row.reason,
    gitRef: row.gitRef,
    createdAt: row.createdAt.toISOString(),
  }));

  // Only worth asking when there is a backlog to be stalled: an idle org
  // should not touch Redis on every poll. The lane list rides along when the
  // queue read happens, so multi-lane installs see where the backlog lives.
  if (queued === 0) return { items, building, queued, builderStalled: false };

  const stats = await laneQueueStats();
  const builderStalled = !stats.anyActive;
  return stats.lanes
    ? { items, building, queued, builderStalled, lanes: stats.lanes }
    : { items, building, queued, builderStalled };
}
