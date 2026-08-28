import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectResource } from "./resource-to-node";

import {
  buildLiveNodes,
  childServiceStatus,
  memberBase,
  type PendingByName,
} from "./build-live-nodes";
import { baseStackServiceStatus } from "./resource-to-node";

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

  // In flight, but each phase says which one it is: an image-only stack never
  // builds anything, so "Building" for a pull or a queued job was a lie (the
  // compose panel stopped telling it first; the node now uses the same words).
  it("names the phase the deploy is actually in", () => {
    expect(cardStatus(stack("building"))).toBe("building");
    expect(cardStatus(stack("starting"))).toBe("deploying");
    expect(cardStatus(stack("pending"))).toBe("queued");
  });

  it("leaves a running stack's missing child to the live-task rollup (offline)", () => {
    // No status → StackServiceCard renders the honest "Service is offline"
    // rather than claiming the card is running.
    expect(cardStatus(stack("running"))).toBeUndefined();
  });
});

/** The rule chain a materialized child goes through: the stack's own state →
 *  `memberBase` → the child's status. Exercised directly rather than through a
 *  hand-built resource row, since these three are the whole behaviour. */
const memberStatus = (
  stackDeployment: ComposeResource["latestDeploymentStatus"],
  childDeployment: Parameters<typeof childServiceStatus>[0]["latestDeploymentStatus"],
) =>
  childServiceStatus(
    { latestDeploymentStatus: childDeployment },
    [],
    memberBase(baseStackServiceStatus(stackDeployment)),
  );

describe("buildLiveNodes stack member with no deployment of its own", () => {
  // The reported bug: a stack mid-deploy showed one member Building and the
  // three the rollout hadn't reached as "Pending" — the word for something
  // staged and not happening — under a header reading "Deploying…".
  it("reads queued while the stack's own deploy is in flight", () => {
    expect(memberStatus("building", null)).toBe("queued");
    expect(memberStatus("starting", null)).toBe("queued");
    expect(memberStatus("pending", null)).toBe("queued");
  });

  it("stays pending when the stack itself has never deployed", () => {
    expect(memberStatus(null, null)).toBe("pending");
  });

  it("marks members of a failed stack failed, not queued forever", () => {
    expect(memberStatus("failed", null)).toBe("error");
  });

  it("prefers the child's own deployment state when it has one", () => {
    expect(memberStatus("building", "building")).toBe("building");
    expect(memberStatus("building", "starting")).toBe("deploying");
    expect(memberStatus("building", "pending")).toBe("queued");
    expect(memberStatus("building", "failed")).toBe("error");
  });
});

describe("buildLiveNodes deleting marker", () => {
  // The node has to SHOW the teardown, because the dialog no longer waits for
  // it: confirm closes at once and this marker is the only thing telling the
  // operator their delete is running.
  it("marks a resource being torn down without removing it early", () => {
    const doomed = stack("running");
    const nodes = buildLiveNodes([doomed], noTasks, {
      creates: [],
      marker: new Map([[`compose:${doomed.name}`, "deleting"]]),
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.pending).toBe("deleting");
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
