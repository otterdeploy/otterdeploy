/**
 * The migration preflight's judgement: what is adopted in place, what only
 * switches owner, and what blocks, with nothing touched.
 */
import { describe, expect, it } from "vite-plus/test";

import { type InventoryContainer, type InventoryResource, assess } from "../migration/assess";

const container = (id: string, resourceId: string, over: Partial<InventoryContainer> = {}) => ({
  id,
  name: `od-${id}`,
  image: "otterdeploy-local/web:abc",
  state: "running",
  labels: { "otterdeploy.managed": "true", "otterdeploy.resource.id": resourceId },
  ...over,
});

const res = (resourceId: string, over: Partial<InventoryResource> = {}): InventoryResource => ({
  resourceId,
  name: resourceId,
  type: "service",
  runtimeOwner: "legacy",
  deploying: false,
  ...over,
});

const base = { hostNode: "node-1", swarmServices: 0, sessionOpen: true };

describe("migration preflight", () => {
  it("adopts one running container in place, and only switches the owner of what is not running", () => {
    const a = assess({
      ...base,
      containers: [container("c1", "res_a")],
      resources: [res("res_a"), res("res_b"), res("res_c", { runtimeOwner: "otterd" })],
    });
    expect(a.installBlockers).toEqual([]);
    expect(a.resources.map((r) => [r.resourceId, r.action, r.containerId])).toEqual([
      ["res_a", "adopt", "c1"],
      ["res_b", "switch-owner", null],
      ["res_c", "done", null],
    ]);
  });

  it("blocks a rollout copy, a stopped container, a deploy in flight and a Swarm task", () => {
    const a = assess({
      ...base,
      containers: [
        container("c1", "res_a"),
        container("c2", "res_a"),
        container("c3", "res_b", { state: "exited" }),
        container("c4", "res_d", {
          labels: {
            "otterdeploy.resource.id": "res_d",
            "com.docker.swarm.service.id": "svc1",
          },
        }),
      ],
      resources: [res("res_a"), res("res_b"), res("res_c", { deploying: true }), res("res_d")],
    });
    const blocked = Object.fromEntries(a.resources.map((r) => [r.resourceId, r]));
    expect(blocked.res_a?.blockers[0]).toContain("2 containers");
    expect(blocked.res_b?.blockers[0]).toContain("exited");
    expect(blocked.res_c?.blockers[0]).toContain("in flight");
    expect(blocked.res_d?.blockers[0]).toContain("Swarm task");
    expect(a.resources.every((r) => r.action === "blocked")).toBe(true);
  });

  it("reports what blocks the whole install: no otterd node, Swarm services, unknown containers", () => {
    const a = assess({
      hostNode: null,
      swarmServices: 2,
      sessionOpen: false,
      containers: [container("c9", "res_gone")],
      resources: [],
    });
    expect(a.installBlockers).toHaveLength(3);
    expect(a.installBlockers.join(" ")).toMatch(
      /no enrolled otterd node.*2 Swarm services.*res_gone/,
    );
  });
});
