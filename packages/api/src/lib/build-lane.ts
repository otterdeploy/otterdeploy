/**
 * Which deploy lane should a project's builds go to?
 *
 * Lanes exist so a dedicated build server's builder (BUILDER_LANE) drains its
 * own queue (packages/jobs/src/lanes.ts). This resolver is the enqueue-side
 * half: it maps a project to a lane through the project's resource placement.
 *
 * Deliberately conservative: a project routes to a named lane ONLY when its
 * placed resources point at exactly one distinct server that is a dedicated
 * build node (`buildServer`) with a `buildLane` configured. Everything else
 * (no placement, mixed placements across several lane-bearing build servers,
 * a lane name that fails validation, or any lookup error) resolves to the
 * default lane, which behaves exactly as the pre-lane single queue. Most
 * installs therefore never leave "default".
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { DEFAULT_DEPLOY_LANE, isDeployLaneName } from "@otterdeploy/jobs/lanes";
import { and, eq, isNotNull } from "drizzle-orm";

/**
 * Resolve the deploy lane for a project's builds. Never throws: lane routing
 * is an optimization layered on the enqueue path, and a resolver failure must
 * degrade to the shared default lane rather than block the deploy (the
 * callers have already inserted the deployment rows).
 */
export async function resolveBuildLane(projectId: ProjectId): Promise<string> {
  try {
    const rows = await db
      .select({ serverId: server.id, buildLane: server.buildLane })
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
    // model the plain select chain.
    const laneByServer = new Map<string, string | null>();
    for (const row of rows) laneByServer.set(row.serverId, row.buildLane);

    if (laneByServer.size !== 1) return DEFAULT_DEPLOY_LANE;
    const [lane] = laneByServer.values();
    if (!lane || !isDeployLaneName(lane)) return DEFAULT_DEPLOY_LANE;
    return lane;
  } catch {
    return DEFAULT_DEPLOY_LANE;
  }
}
