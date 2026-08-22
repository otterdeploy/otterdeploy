/**
 * Where does a service's image get BUILT, and on which queue?
 *
 * Separate from where it RUNS. That separation is the entire point of a
 * dedicated build server: build on the 4 GB box, run on the node serving
 * traffic. `resource.placementServerId` answers "where does the container
 * run"; this answers "where does the image get made".
 *
 * Resolution, most specific wins:
 *
 *   1. `serviceResource.buildServerId` - this one service has its own box
 *   2. `project.buildServerId`         - the project shares a builder
 *   3. nothing                         - build on the shared default lane,
 *                                        which is what every install starts on
 *
 * The predecessor (`build-lane.ts`) inferred the target by joining through
 * `resource.placementServerId`, i.e. "a project builds on a build server if
 * its resources happen to be placed there". That cannot express "build here,
 * run there" - and worse, the headline case (a box that runs NOTHING and only
 * builds) has no placed resources at all, so it resolved to the default lane
 * and the build silently ran on the control plane. Assignment is now explicit.
 *
 * Everything here degrades to the default lane rather than throwing. Lane
 * routing is an optimisation layered on the enqueue path, and the callers have
 * already inserted deployment rows: a resolver failure must not strand them.
 * The one thing that DOES fail loudly is a missing registry, and that is
 * checked separately (see `assertBuildTargetCanShip`), before a build starts.
 */

import type { ProjectId, ResourceId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { DEFAULT_DEPLOY_LANE, isDeployLaneName, laneHasConsumer } from "@otterdeploy/jobs/lanes";
import { and, eq, isNotNull } from "drizzle-orm";

export interface BuildTarget {
  /** The dedicated build server, or null when building on the default lane. */
  serverId: ServerId | null;
  /** Human-readable server name, for logs and the deployment record. */
  serverName: string | null;
  /** BullMQ deploy lane to enqueue onto. Always valid. */
  lane: string;
  /** Why this target was chosen, for the build log. */
  reason: "service" | "project" | "placement" | "default";
}

const DEFAULT_TARGET: BuildTarget = {
  serverId: null,
  serverName: null,
  lane: DEFAULT_DEPLOY_LANE,
  reason: "default",
};

/**
 * Resolve the build target for one service's deployment.
 *
 * `resourceId` is optional so callers that only know the project (a whole-
 * project apply) still get the project-level answer.
 */
export async function resolveBuildTarget(
  projectId: ProjectId,
  resourceId?: ResourceId | null,
): Promise<BuildTarget> {
  try {
    const assigned = await resolveAssignedServer(projectId, resourceId);
    if (assigned) {
      const target = await targetForServer(assigned.serverId, assigned.reason);
      if (target) return target;
      // Assigned to a server that is missing, not a build server, or has no
      // usable lane. Fall through: a stale assignment must not wedge builds.
      return DEFAULT_TARGET;
    }
    // Backward compatibility: before assignment existed, a project routed to a
    // build server its resources were PLACED on. Preserved so an install that
    // (accidentally) relies on it keeps its lane after upgrading. Explicit
    // assignment always wins over this.
    return await resolveByPlacement(projectId);
  } catch {
    return DEFAULT_TARGET;
  }
}

/** The explicitly assigned server id, service first then project. */
async function resolveAssignedServer(
  projectId: ProjectId,
  resourceId: ResourceId | null | undefined,
): Promise<{ serverId: ServerId; reason: "service" | "project" } | null> {
  if (resourceId) {
    const [svc] = await db
      .select({ buildServerId: serviceResource.buildServerId })
      .from(serviceResource)
      .where(eq(serviceResource.resourceId, resourceId))
      .limit(1);
    if (svc?.buildServerId) return { serverId: svc.buildServerId, reason: "service" };
  }
  const [proj] = await db
    .select({ buildServerId: project.buildServerId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (proj?.buildServerId) return { serverId: proj.buildServerId, reason: "project" };
  return null;
}

/** Build a target from a server row, or null when it can't serve as one. */
async function targetForServer(
  serverId: ServerId,
  reason: BuildTarget["reason"],
): Promise<BuildTarget | null> {
  const [row] = await db
    .select({
      id: server.id,
      name: server.name,
      lane: server.buildLane,
      isBuild: server.buildServer,
    })
    .from(server)
    .where(eq(server.id, serverId))
    .limit(1);
  if (!row || !row.isBuild) return null;
  // A build server with no lane drains the default queue, which is still a
  // valid (if unsegregated) setup: the builder there competes with everyone
  // else's. Name the server anyway so logs stay honest about where it ran.
  const lane = row.lane && isDeployLaneName(row.lane) ? row.lane : DEFAULT_DEPLOY_LANE;
  return { serverId: row.id, serverName: row.name, lane, reason };
}

/**
 * Legacy path: a project whose placed resources all sit on exactly one
 * lane-bearing build server routes to that lane. Conservative by design -
 * anything ambiguous resolves to the default.
 */
async function resolveByPlacement(projectId: ProjectId): Promise<BuildTarget> {
  const rows = await db
    .select({ serverId: server.id, name: server.name, lane: server.buildLane })
    .from(resource)
    .innerJoin(server, eq(server.id, resource.placementServerId))
    .where(
      and(
        eq(resource.projectId, projectId),
        eq(server.buildServer, true),
        isNotNull(server.buildLane),
      ),
    );

  // Distinct in JS rather than SQL so a hand-rolled test mock only has to
  // model the plain select chain. The branded id lives in the VALUE, not the
  // key: a Map key round-trip would erase the brand and force a cast back.
  const byServer = new Map<string, { id: ServerId; name: string; lane: string | null }>();
  for (const row of rows) {
    byServer.set(row.serverId, { id: row.serverId, name: row.name, lane: row.lane });
  }
  if (byServer.size !== 1) return DEFAULT_TARGET;

  const [only] = [...byServer.values()];
  if (!only || !only.lane || !isDeployLaneName(only.lane)) return DEFAULT_TARGET;
  return { serverId: only.id, serverName: only.name, lane: only.lane, reason: "placement" };
}

/**
 * Resolve the lane only. Kept as the narrow entry point for enqueue paths that
 * don't need the rest of the target.
 */
export async function resolveBuildLane(
  projectId: ProjectId,
  resourceId?: ResourceId | null,
): Promise<string> {
  return (await resolveBuildTarget(projectId, resourceId)).lane;
}

/**
 * Refuse a build that would produce an image the run nodes cannot pull.
 *
 * The default image path is registry-less: the builder `--load`s into the host
 * docker daemon and the container runs on that same host, so no push is needed
 * (see apps/builder/src/load.ts). The moment the build target and the run
 * target differ, that assumption breaks - the image exists only in the build
 * box's daemon and every run node fails to pull it.
 *
 * Nothing detected that before, so the failure surfaced late and opaquely: a
 * green build, then a deploy that can't start. This is knowable at assignment
 * time and again at enqueue time, so we say it in both places rather than
 * spending build minutes on an image nobody can run.
 *
 * Returns null when the setup is shippable, or an operator-facing reason when
 * it isn't.
 */
export function buildTargetBlocker(opts: {
  /** Resolved build server, null when building on the default lane. */
  target: Pick<BuildTarget, "serverId" | "serverName">;
  /** The service's `imageRepository` (its push target), if any. */
  imageRepository: string | null | undefined;
}): string | null {
  if (!opts.target.serverId) return null;
  if (opts.imageRepository?.trim()) return null;
  const where = opts.target.serverName ? `"${opts.target.serverName}"` : "a dedicated build server";
  return (
    `This service builds on ${where}, but has no image target, so the built image would stay ` +
    `on that server and the nodes running the service could not pull it. Set an image ` +
    `repository (and a matching registry credential) on the service, or clear its build server ` +
    `to build where it runs.`
  );
}

/**
 * Split a batch of just-inserted deployments into one group per build lane.
 *
 * A push can touch several services at once, and with per-service build
 * servers they no longer all belong on the same queue. Enqueuing the batch on
 * a single lane would silently ignore every override but the first, so callers
 * enqueue once per group instead.
 *
 * Resolution failures collapse into the default lane (see `resolveBuildTarget`),
 * so every deployment always lands in exactly one group: none are dropped.
 */
export async function groupDeploymentsByLane(
  projectId: ProjectId,
  entries: ReadonlyArray<{ deploymentId: string; resourceId: ResourceId }>,
): Promise<Map<string, string[]>> {
  const groups = new Map<string, string[]>();
  // Resolve per distinct resource, not per deployment: a preview batch can
  // carry several deployments for the same service.
  const laneByResource = new Map<ResourceId, string>();
  for (const entry of entries) {
    let lane = laneByResource.get(entry.resourceId);
    if (lane === undefined) {
      lane = (await resolveBuildTarget(projectId, entry.resourceId)).lane;
      laneByResource.set(entry.resourceId, lane);
    }
    const bucket = groups.get(lane);
    if (bucket) bucket.push(entry.deploymentId);
    else groups.set(lane, [entry.deploymentId]);
  }
  return groups;
}

/**
 * Why this build target cannot serve a build right now, or null when it can.
 *
 * Two failure modes, both of which used to end as a deployment stuck on
 * `pending` with no logs and no error — the least debuggable state the product
 * has, and the same one `enqueueGitBuild` already guards for a Redis outage:
 *
 *   - the assigned server isn't ready (still provisioning, failed, removed)
 *   - nothing is draining its lane (no builder deployed there yet, or it died)
 *
 * Callers fail the deployment with this reason instead of enqueuing. Failing
 * loudly beats falling back to the default lane silently: a build that lands
 * on the wrong machine may not even have the registry credentials to ship its
 * image, and the operator assigned a build server deliberately.
 *
 * Never throws; a check that can't run reports "ready" so a monitoring blip
 * can't block a deploy that would have worked.
 */
export async function buildTargetUnavailable(target: BuildTarget): Promise<string | null> {
  if (!target.serverId) return null;
  const name = target.serverName ?? target.serverId;
  try {
    const [row] = await db
      .select({ status: server.status, provisionStatus: server.provisionStatus })
      .from(server)
      .where(eq(server.id, target.serverId))
      .limit(1);
    if (!row) {
      return `Build server "${name}" no longer exists. Clear it from the build settings to build where the service runs.`;
    }
    if (row.provisionStatus !== "ready" || row.status !== "ready") {
      return (
        `Build server "${name}" isn't ready (status: ${row.status}, provisioning: ${row.provisionStatus}), ` +
        `so this build has nowhere to run. Fix the server, or clear it from the build settings.`
      );
    }
    if (!(await laneHasConsumer(target.lane))) {
      return (
        `No builder is draining lane "${target.lane}" on build server "${name}", so this build would ` +
        `queue forever. Check the builder is running there with BUILDER_LANE=${target.lane}.`
      );
    }
    return null;
  } catch {
    return null;
  }
}
