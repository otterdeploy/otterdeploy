import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectResource } from "./resource-to-node";

import { buildLiveNodes, type PendingByName } from "./build-live-nodes";

const noTasks = new Map();

/** A deployed compose stack declaring one service, with no child service
 *  resource materialized for it, which is the state a stack is left in when
 *  its build fails, since the reconciler never gets as far as creating one. */
type ComposeResource = Extract<ProjectResource, { type: "compose" }>;

function stack(latestDeploymentStatus: ComposeResource["latestDeploymentStatus"]): ComposeResource {
  return {
    resourceId: createId(ID_PREFIX.resource),
    projectId: createId(ID_PREFIX.project),
    environmentId: createId(ID_PREFIX.environment),
    name: "it-tools-2",
    type: "compose",
    status: "valid",
    latestDeploymentStatus,
    latestDeploymentStartedAt: null,
    latestDeploymentFinishedAt: null,
    source: "inline",
    stackName: "store-it-tools-2",
    logoBrand: null,
    services: [
      {
        name: "it-tools",
        serviceName: "store-it-tools-2_it-tools",
        image: "corentinth/it-tools:latest",
        hasBuild: false,
        ports: [80],
        volumes: [],
      },
    ],
  };
}

const cardStatus = (resource: ProjectResource) =>
  buildLiveNodes([resource], noTasks)[0]?.data.services?.[0]?.status;

describe("buildLiveNodes stack service status", () => {
  // The graph used to hardcode "building" for any declared service without a
  // child resource. A failed build never creates one, so the node span
  // "Deploying…"/"Building" forever while the stack's own Deployments tab read
  // FAILED. Two surfaces contradicting each other about one deploy.
  it("reports a failed stack deploy as failed, not as still building", () => {
    expect(cardStatus(stack("failed"))).toBe("error");
    expect(cardStatus(stack("crashed"))).toBe("error");
  });

  it("still reads as building while the deploy is genuinely in flight", () => {
    expect(cardStatus(stack("building"))).toBe("building");
    expect(cardStatus(stack("pending"))).toBe("building");
    expect(cardStatus(stack("starting"))).toBe("building");
  });

  it("leaves a running stack's missing child to the live-task rollup (offline)", () => {
    // No status → StackServiceCard renders the honest "Service is offline"
    // rather than claiming the card is running.
    expect(cardStatus(stack("running"))).toBeUndefined();
  });
});

describe("buildLiveNodes ghost synthesis", () => {
  it("appends a ghost node for each staged create", () => {
    const pending: PendingByName = {
      creates: [
        { resource: "service", name: "web" },
        { resource: "database", name: "db" },
      ],
      marker: new Map(),
    };
    const nodes = buildLiveNodes([], noTasks, pending);
    expect(nodes).toHaveLength(2);

    // Ghost shares the id its applied counterpart will get (`${kind}:${name}`)
    // (not a `pending:`-prefixed synthetic id) so Apply updates in place.
    const web = nodes.find((n) => n.id === "service:web");
    expect(web).toMatchObject({
      type: "resource",
      data: {
        kind: "service",
        name: "web",
        pending: "create",
        description: "New service (pending)",
      },
    });

    const db = nodes.find((n) => n.id === "database:db");
    expect(db).toMatchObject({
      data: {
        kind: "database",
        name: "db",
        pending: "create",
        description: "New database (pending)",
      },
    });
  });

  it("returns no nodes when there are no resources and no pending creates", () => {
    expect(buildLiveNodes([], noTasks)).toEqual([]);
    expect(buildLiveNodes([], noTasks, { creates: [], marker: new Map() })).toEqual([]);
  });
});
