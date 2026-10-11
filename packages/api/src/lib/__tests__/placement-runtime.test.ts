/**
 * The plain-Docker runtime starts every container on the control plane, so a
 * pin to any other server is a placement it cannot honour. Accepting one
 * recorded a workload as living on a worker while it ran on the control plane
 * (a compose stack, a service, a database). It is refused, with the server
 * named, where the operator chose it.
 */
import { hasPrefix, ID_PREFIX, type OrganizationId } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The two servers of the org: the control plane (the bootstrap row, at
// 127.0.0.1) and one worker. The lookups only ever read id, name and host.
const servers = vi.hoisted(() => [
  { id: "srv_cp", name: "localhost", host: "127.0.0.1" },
  { id: "srv_w1", name: "w1", host: "10.0.0.7" },
]);

vi.mock("../../runtime", () => ({ isSwarmRuntime: vi.fn() }));
vi.mock("../../routers/server/queries", () => ({
  getServerInOrg: async (input: { serverId: string }) =>
    servers.find((s) => s.id === input.serverId),
  getServerByNameInOrg: async (input: { name: string }) =>
    servers.find((s) => s.name === input.name),
}));

import { refuseUnrunnablePlacement } from "../../routers/project/manifest-apply-placement";
import { isSwarmRuntime } from "../../runtime";
import { manifestSchema } from "../../stack/manifest/schema";
import {
  PlacementNeedsSwarmError,
  resolvePlacementByName,
  resolvePlacementSeed,
  resolveRunPlacementSeed,
} from "../placement-seed";

function orgId(value: string): OrganizationId {
  if (!hasPrefix(value, ID_PREFIX.organization)) throw new Error(`not an org id: ${value}`);
  return value;
}
const organizationId = orgId("org_1");

const controlPlane = { id: "srv_cp" };
const worker = { id: "srv_w1" };

describe("run placement on the plain-Docker runtime", () => {
  beforeEach(() => vi.mocked(isSwarmRuntime).mockReturnValue(false));

  it("refuses a worker, naming it", async () => {
    const result = await resolveRunPlacementSeed({ serverId: worker.id, organizationId });
    expect(result.isErr() && PlacementNeedsSwarmError.is(result.error)).toBe(true);
    expect(result.isErr() ? result.error.message : "").toContain('"w1"');
    expect(result.isErr() ? result.error.message : "").toContain("control plane only");
  });

  it("accepts the control plane and no pin at all", async () => {
    const cp = await resolveRunPlacementSeed({ serverId: controlPlane.id, organizationId });
    expect(cp.isOk() ? cp.value : "err").toBe(controlPlane.id);
    const none = await resolveRunPlacementSeed({ serverId: null, organizationId });
    expect(none.isOk() ? none.value : "err").toBeNull();
  });

  it("refuses a worker a manifest names", async () => {
    const result = await resolvePlacementByName({ serverName: "w1", organizationId });
    expect(result.isErr() && PlacementNeedsSwarmError.is(result.error)).toBe(true);
  });

  it("leaves a build server alone: a builder drains its lane on any runtime", async () => {
    const result = await resolvePlacementSeed({ serverId: worker.id, organizationId });
    expect(result.isOk() ? result.value : "err").toBe(worker.id);
  });
});

describe("run placement on Swarm", () => {
  it("accepts a worker", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(true);
    const result = await resolveRunPlacementSeed({ serverId: worker.id, organizationId });
    expect(result.isOk() ? result.value : "err").toBe(worker.id);
  });
});

describe("staging a manifest that names a worker", () => {
  const manifest = (server?: string) =>
    manifestSchema.parse({
      project: "acme",
      composes: { probe: { source: "inline", content: "services: {}", server } },
    });

  it("is refused on plain Docker when the save newly names it", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(false);
    const result = await refuseUnrunnablePlacement({
      previous: manifest(),
      next: manifest("w1"),
      organizationId,
    });
    expect(result.isErr() && PlacementNeedsSwarmError.is(result.error)).toBe(true);
  });

  it("does not block an unrelated save of a pin staged before", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(false);
    const result = await refuseUnrunnablePlacement({
      previous: manifest("w1"),
      next: manifest("w1"),
      organizationId,
    });
    expect(result.isOk()).toBe(true);
  });
});
