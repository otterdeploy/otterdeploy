import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { describe, expect, test, vi } from "vite-plus/test";

// Stub every collaborator redeployOne pulls in, so we can drive the one
// behaviour under test: what happens when runtime().update() throws.
vi.mock("../queries", () => ({
  bumpForceUpdateCounter: vi.fn(),
  getServiceRecord: vi.fn(),
  updateServiceResourceStatus: vi.fn(),
}));
vi.mock("../../../lib/variables", () => ({
  findTransitiveDependents: vi.fn(),
  resolveServiceEnv: vi.fn(),
}));
vi.mock("../../../lib/environment/load", () => ({
  loadPreviewScope: vi.fn(),
}));
vi.mock("../spec", () => ({
  buildSwarmSpec: vi.fn(),
}));
vi.mock("../../../runtime", () => ({
  runtime: vi.fn(),
}));

import * as environment from "../../../lib/environment/load";
import { runtime } from "../../../runtime";
import * as variables from "../../../lib/variables";
import * as queries from "../queries";
import { redeployOne } from "../redeploy";
import * as spec from "../spec";

const projectId = "project_test" as ProjectId;
const resourceId = "resource_test" as ResourceId;

const fakeRecord = {
  service: {
    resourceId,
    serviceName: "svc",
    networkName: "net",
    image: "ghcr.io/acme/svc:latest",
  },
  resource: { name: "svc" },
} as never;

function primeCommonMocks(): void {
  vi.mocked(queries.bumpForceUpdateCounter).mockResolvedValue(undefined as never);
  vi.mocked(queries.getServiceRecord).mockResolvedValue(fakeRecord);
  vi.mocked(queries.updateServiceResourceStatus).mockResolvedValue(undefined as never);
  vi.mocked(variables.resolveServiceEnv).mockResolvedValue(Result.ok({}) as never);
  vi.mocked(environment.loadPreviewScope).mockResolvedValue(undefined as never);
  vi.mocked(spec.buildSwarmSpec).mockResolvedValue({} as never);
}

describe("redeployOne", () => {
  test("returns Ok with an errored runtime when runtime().update throws (env-set 500 fix)", async () => {
    primeCommonMocks();
    const update = vi.fn().mockRejectedValue(new Error("swarm unreachable"));
    vi.mocked(runtime).mockReturnValue({ update } as never);

    const result = await redeployOne(projectId, resourceId, "proj");

    // The infra throw must NOT propagate — the DB write already succeeded, so
    // the caller (e.g. `env set`) reports success and the node shows an error.
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.status).toBe("error");
    expect(vi.mocked(queries.updateServiceResourceStatus)).toHaveBeenCalledWith(
      resourceId,
      "invalid",
    );
  });

  test("returns Ok with the live runtime when update succeeds", async () => {
    primeCommonMocks();
    const runningRuntime = {
      serviceId: "s1",
      serviceName: "svc",
      networkName: "net",
      status: "running",
      health: null,
    };
    const update = vi.fn().mockResolvedValue(runningRuntime);
    vi.mocked(runtime).mockReturnValue({ update } as never);

    const result = await redeployOne(projectId, resourceId, "proj");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.status).toBe("running");
    expect(vi.mocked(queries.updateServiceResourceStatus)).toHaveBeenCalledWith(resourceId, "valid");
  });
});
