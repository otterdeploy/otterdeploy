/**
 * A database pinned to a worker on the plain-Docker runtime kept running on
 * the control plane: the pin was recorded and the restart that "applied" it
 * started the engine where it already was. The pin is now refused, and
 * nothing is written.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const servers = vi.hoisted(() => [
  { id: "srv_cp", name: "localhost", host: "127.0.0.1" },
  { id: "srv_w1", name: "w1", host: "10.0.0.7" },
]);
const setResourcePlacement = vi.hoisted(() => vi.fn(async () => undefined));
const restartDatabaseResource = vi.hoisted(() => vi.fn());

vi.mock("../../../runtime", () => ({ isSwarmRuntime: vi.fn() }));
vi.mock("../../server/queries", () => ({
  getServerInOrg: async (input: { serverId: string }) =>
    servers.find((s) => s.id === input.serverId),
  getServerByNameInOrg: async () => undefined,
}));
vi.mock("../queries", () => ({ getProjectInOrg: async () => ({ id: "prj_1" }) }));
vi.mock("../queries/postgres-resource", () => ({
  getDatabaseResourceRecord: async () => ({
    resource: { id: "res_db", name: "db", status: "draft", placementServerId: null },
  }),
}));
vi.mock("../../service/queries", () => ({ setResourcePlacement }));
vi.mock("../postgres", () => ({ restartDatabaseResource }));

import { PlacementNeedsSwarmError } from "../../../lib/placement-seed";
import { isSwarmRuntime } from "../../../runtime";
import { setDatabasePlacement } from "../database-placement";

const log: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

const input = (serverId: string) => ({
  projectId: idSchema.project.parse("prj_1"),
  resourceId: idSchema.resource.parse("res_db"),
  organizationId: idSchema.organization.parse("org_1"),
  serverId,
});

beforeEach(() => setResourcePlacement.mockClear());

describe("database placement", () => {
  it("refuses a worker on plain Docker and records nothing", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(false);
    const result = await setDatabasePlacement(input("srv_w1"), log);
    expect(result.isErr() && PlacementNeedsSwarmError.is(result.error)).toBe(true);
    expect(setResourcePlacement).not.toHaveBeenCalled();
  });

  it("pins to the control plane on plain Docker", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(false);
    const result = await setDatabasePlacement(input("srv_cp"), log);
    expect(result.isOk()).toBe(true);
    expect(setResourcePlacement).toHaveBeenCalledWith("res_db", "srv_cp");
  });

  it("pins to a worker on Swarm", async () => {
    vi.mocked(isSwarmRuntime).mockReturnValue(true);
    const result = await setDatabasePlacement(input("srv_w1"), log);
    expect(result.isOk()).toBe(true);
    expect(setResourcePlacement).toHaveBeenCalledWith("res_db", "srv_w1");
  });
});
