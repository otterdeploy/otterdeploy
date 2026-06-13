/**
 * Mapping from oRPC `ProjectResource` union → React-Flow node shape consumed
 * by the graph canvas. Pure function. Services get a base node without
 * replicas — the graph layout enriches them with live tasks from
 * project.serviceTasks once those come back.
 */

import type { Node } from "@xyflow/react";

import type { InferRouterOutputs } from "@orpc/server";

import type { AppRouter } from "@otterdeploy/api/routers/index";

import type {
  ResourceNodeData,
  ResourceStatus,
} from "./resource-node";

export type ProjectResource = InferRouterOutputs<AppRouter>["project"]["resource"]["list"][number];

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

/**
 * Map a database's swarm runtime to the same running/building/error pill the
 * service nodes use. `null` when the runtime hasn't been provisioned yet so
 * the node renders without a status badge instead of a false "ok".
 */
function databaseStatus(
  runtime: Extract<ProjectResource, { type: "database" }>["runtime"],
): ResourceStatus | undefined {
  switch (runtime.status) {
    case "running":
      return runtime.health === "unhealthy" ? "error" : "running";
    case "starting":
      return "building";
    case "error":
    case "stopped":
    case "missing":
      return "error";
  }
}

/**
 * Map a service's latest-deployment status to the node pill. This is the only
 * status signal for build-time states — a failed/pending/building deployment
 * schedules no swarm tasks, so the live-task rollup in build-live-nodes can't
 * surface it. Once tasks exist that rollup takes precedence over this base.
 * `superseded`/`removed`/null → no pill (historical or never-deployed).
 */
function serviceDeploymentStatus(
  status: Extract<ProjectResource, { type: "service" }>["latestDeploymentStatus"],
): ResourceStatus | undefined {
  switch (status) {
    case "running":
      return "running";
    case "building":
    case "pending":
      return "building";
    case "failed":
      return "error";
    default:
      return undefined;
  }
}

export function resourceToNode(r: ProjectResource): ResourceFlowNode {
  switch (r.type) {
    case "database":
      return {
        id: r.resourceId,
        type: "resource",
        // Dagre will overwrite these — keep at origin so an un-laid-out node
        // is still mountable (useful in tests).
        position: { x: 0, y: 0 },
        data: {
          kind: "database",
          name: r.name,
          description: `${r.engine} database`,
          engine: r.engine,
          status: databaseStatus(r.runtime),
        },
      };
    case "service":
      return {
        id: r.resourceId,
        type: "resource",
        position: { x: 0, y: 0 },
        data: {
          kind: "service",
          name: r.name,
          // Until services carry a description field, the image string is the
          // most informative single line we can show.
          description: r.image,
          tech: { label: r.image },
          // Brand logo for the header tile. Detected at build time and stored
          // on the resource — read straight off the record, no git-API call.
          // Undefined (no logo) until the first build populates it.
          framework: r.framework ?? undefined,
          // Base pill from the latest deployment. build-live-nodes overrides
          // this with the live-task rollup once tasks exist; until then (and
          // for build failures, which never schedule tasks) this is what
          // surfaces — so a failed build shows "error" instead of nothing.
          status: serviceDeploymentStatus(r.latestDeploymentStatus),
        },
      };
  }
}
