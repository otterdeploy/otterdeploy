/**
 * Mapping from oRPC `ProjectResource` union → React-Flow node shape consumed
 * by the graph canvas. Pure function. Services get a base node without
 * replicas: the graph layout enriches them with live tasks from
 * project.serviceTasks once those come back.
 */

import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";
import type { Node } from "@xyflow/react";

import { frameworkLabel } from "@/features/projects/components/framework-logo";
import { shortImageRef } from "@/shared/lib/image-ref";

import type { ResourceNodeData, ResourceStatus, StackServiceStatus } from "./resource-node";

export type ProjectResource = InferRouterOutputs<AppRouter>["project"]["resource"]["list"][number];

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

/**
 * Map a database's swarm runtime to the same running/building/error pill the
 * service nodes use. `null` when the runtime hasn't been provisioned yet so
 * the node renders without a status badge instead of a false "ok".
 */
function databaseStatus(
  r: Extract<ProjectResource, { type: "database" }>,
): ResourceStatus | undefined {
  switch (r.runtime.status) {
    case "running":
      return r.runtime.health === "unhealthy" ? "error" : "running";
    case "starting":
      return "building";
    case "error":
    case "stopped":
    case "missing": {
      // A deploy in flight legitimately has no container yet. The image is
      // still pulling or the create hasn't reached docker. That's "building",
      // not a failure; only a dead container with NO active deployment (or a
      // deployment that actually failed) earns the error pill.
      const dep = r.latestDeploymentStatus;
      if (dep === "building" || dep === "pending" || dep === "starting") return "building";
      return "error";
    }
  }
}

/**
 * Map a service's latest-deployment status to the node pill. This is the only
 * status signal for build-time states. A failed/pending/building deployment
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
    // Queued but not yet building. The job is enqueued and the builder hasn't
    // started the image build. Distinct from "building" so the pill matches the
    // Details phase stepper (which shows "Queued") instead of claiming a build
    // is underway before it is.
    case "pending":
      return "queued";
    case "starting":
    case "building":
      return "building";
    case "crashed":
    case "failed":
      return "error";
    // Scaled to zero on purpose: surface a calm "paused" pill (the live-task
    // rollup keeps this base since a paused service has no tasks).
    case "paused":
      return "paused";
    default:
      return undefined;
  }
}

/**
 * Build-time base status for a compose sub-service, derived from the stack's
 * latest deployment. This is the resting state before live swarm tasks arrive;
 * build-live-nodes overrides each service with its own task rollup once tasks
 * exist (so a running stack with one dead service shows that service offline).
 */
export function baseStackServiceStatus(
  dep: Extract<ProjectResource, { type: "compose" }>["latestDeploymentStatus"],
): StackServiceStatus | undefined {
  switch (dep) {
    case "building":
      return "building";
    case "starting":
      // Rolling out, not compiling: an image-only stack never builds.
      return "deploying";
    case "pending":
      // The deploy is enqueued; nothing has started.
      return "queued";
    case "crashed":
    case "failed":
      return "error";
    case "running":
      // Deployed. Let the live-task rollup decide running vs offline.
      return undefined;
    default:
      // Never deployed (null) → staged. superseded/removed → unknown.
      return dep == null ? "pending" : undefined;
  }
}

/** One calm sentence for the service card body. A git-built service's image
 *  ref is an internal artifact. Say what the thing IS (framework + origin)
 *  and leave the machine ref to the muted footer. A pulled image IS the
 *  identity, so its (shortened) ref stays the description. */
function serviceDescription(r: Extract<ProjectResource, { type: "service" }>): string {
  if (r.source !== "git") return shortImageRef(r.image);
  return r.framework ? `${frameworkLabel(r.framework)} · built from source` : "Built from source";
}

/**
 * The node pill's status for any resource, without building the whole node.
 *
 * Exported so surfaces that list resources outside the canvas (the panel's
 * resource switcher) show the SAME state the graph does. A second mapping
 * would drift the first time one of these rules changed, and a switcher that
 * says "running" over a node that says "error" is worse than no dot at all.
 */
export function resourceStatus(r: ProjectResource): ResourceStatus | undefined {
  switch (r.type) {
    case "database":
      return databaseStatus(r);
    case "service":
      return serviceDeploymentStatus(r.latestDeploymentStatus);
    case "compose":
      // A stack has no single status of its own: the graph rolls its
      // children up (stackRollup) and the children aren't in this row.
      return undefined;
  }
}

export function resourceToNode(r: ProjectResource): ResourceFlowNode {
  switch (r.type) {
    case "database":
      return {
        // Identity is `${type}:${name}`, NOT the resourceId. A staged-create
        // ghost shares this id, so when Apply lands the real resource the node
        // updates in place instead of unmounting (old id) + remounting (new
        // resourceId), which is what made nodes "disappear and reappear". The
        // real resourceId rides on data for navigation/actions.
        id: `database:${r.name}`,
        type: "resource",
        // Dagre will overwrite these. Keep at origin so an un-laid-out node
        // is still mountable (useful in tests).
        position: { x: 0, y: 0 },
        data: {
          kind: "database",
          name: r.name,
          description: `${r.engine} database`,
          projectId: r.projectId,
          resourceId: r.resourceId,
          engine: r.engine,
          internalHostname: r.internalHostname,
          status: databaseStatus(r),
        },
      };
    case "service":
      return {
        id: `service:${r.name}`,
        type: "resource",
        position: { x: 0, y: 0 },
        data: {
          kind: "service",
          name: r.name,
          description: serviceDescription(r),
          projectId: r.projectId,
          resourceId: r.resourceId,
          internalHostname: r.internalHostname,
          // Machine ref belongs in the muted footer, shortened. A pulled image
          // already IS the description, no footer echo for those.
          ...(r.source === "git" ? { tech: { label: shortImageRef(r.image) } } : {}),
          // Pulled images carry the ref so header tiles can resolve the app's
          // brand mark. Git/upload builds produce internal artifact refs with
          // no brand identity, so those stay off the node.
          ...(r.source === "image" ? { image: r.image } : {}),
          // Brand logo for the header tile. Detected at build time and stored
          // on the resource: read straight off the record, no git-API call.
          // Undefined (no logo) until the first build populates it.
          framework: r.framework ?? undefined,
          // Base pill from the latest deployment. build-live-nodes overrides
          // this with the live-task rollup once tasks exist; until then (and
          // for build failures, which never schedule tasks) this is what
          // surfaces, so a failed build shows "error" instead of nothing.
          status: serviceDeploymentStatus(r.latestDeploymentStatus),
          // Gated on publicEnabled, not just a non-null domain: a service can
          // retain the host it used to serve on after being unexposed, and
          // offering "Visit" for that would link to a 404.
          publicUrl: r.publicEnabled ? r.publicDomain : null,
          latestDeploymentStartedAt: r.latestDeploymentStartedAt,
          latestDeploymentFinishedAt: r.latestDeploymentFinishedAt,
        },
      };
    case "compose":
      return {
        id: `compose:${r.name}`,
        type: "resource",
        position: { x: 0, y: 0 },
        data: {
          kind: "compose",
          name: r.name,
          // Stack source + service count is the most useful single line.
          description: r.services.length === 1 ? "1 service" : `${r.services.length} services`,
          logoBrand: r.logoBrand ?? undefined,
          projectId: r.projectId,
          resourceId: r.resourceId,
          // The group has NO single status pill. Each service answers for
          // itself. build-live-nodes enriches these with live per-service task
          // state; this is the build-time base derived from the stack deploy.
          services: r.services.map((s) => ({
            name: s.name,
            image: s.image,
            hasBuild: s.hasBuild,
            volumes: s.volumes,
            status: baseStackServiceStatus(r.latestDeploymentStatus),
          })),
        },
      };
  }
}
