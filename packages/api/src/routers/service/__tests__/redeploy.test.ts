import { idSchema } from "@otterdeploy/shared/id";
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

import type { RuntimeDriver } from "../../../runtime";
import type { SwarmServiceSpec } from "../../../swarm";
import type { ServiceRecord } from "../queries";

import * as environment from "../../../lib/environment/load";
import * as variables from "../../../lib/variables";
import { runtime } from "../../../runtime";
import * as queries from "../queries";
import { redeployOne } from "../redeploy";
import * as spec from "../spec";

const projectId = idSchema.project.parse("prj_test");
const resourceId = idSchema.resource.parse("res_test");

const fakeRecord: ServiceRecord = {
  resource: {
    id: resourceId,
    projectId,
    name: "svc",
    type: "service",
    status: "valid",
    environmentId: null,
    previewId: null,
    branchedFromResourceId: null,
    placementServerId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  service: {
    resourceId,
    image: "ghcr.io/acme/svc:latest",
    imageDigest: null,
    command: null,
    entrypoint: null,
    extraNetworks: [],
    composeService: null,
    source: "image",
    sourceSubdir: null,
    framework: null,
    replicas: 1,
    pausedReplicas: null,
    restartCondition: "on-failure",
    restartMaxAttempts: null,
    restartDelayMs: 5000,
    restartWindowMs: null,
    healthcheckCmd: null,
    healthcheckIntervalMs: null,
    healthcheckTimeoutMs: null,
    healthcheckRetries: null,
    healthcheckStartMs: null,
    cpuLimit: null,
    memoryLimitMb: null,
    cpuReservation: null,
    memoryReservationMb: null,
    diskLimitMb: null,
    swapLimitMb: null,
    pidsLimit: null,
    preDeploy: null,
    postDeploy: null,
    buildConfig: null,
    gitRepoId: null,
    branch: null,
    imageRepository: null,
    previewsEnabled: false,
    internalHostname: "svc",
    serviceName: "svc",
    networkName: "net",
    publicEnabled: false,
    publicDomain: null,
    stackId: null,
    forceUpdateCounter: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  ports: [],
  env: [],
  mounts: [],
};

// The spec only flows into the (mocked) runtime driver, so its contents are
// irrelevant to these tests; it just has to be a complete, well-typed value.
const fakeSpec: SwarmServiceSpec = {
  resourceId,
  resourceName: "svc",
  projectSlug: "proj",
  serviceName: "svc",
  internalHostname: "svc",
  image: "ghcr.io/acme/svc:latest",
  env: {},
  replicas: 1,
  restart: { condition: "on-failure", delayMs: 5000 },
  ports: [],
  mounts: [],
  forceUpdateCounter: 0,
};

/** A driver whose only reachable method is `update`; anything else is a bug. */
function stubRuntime(update: RuntimeDriver["update"]): RuntimeDriver {
  const unexpected = (): never => {
    throw new Error("unexpected runtime call in redeploy.test");
  };
  return {
    kind: "swarm",
    provision: unexpected,
    update,
    destroy: unexpected,
    inspect: unexpected,
    inspectMany: unexpected,
    provisionDatabase: unexpected,
    updateDatabase: unexpected,
    destroyDatabase: unexpected,
    inspectDatabase: unexpected,
    branchDatabase: unexpected,
    destroyDatabaseBranch: unexpected,
  };
}

function primeCommonMocks(): void {
  vi.mocked(queries.bumpForceUpdateCounter).mockResolvedValue(undefined);
  vi.mocked(queries.getServiceRecord).mockResolvedValue(fakeRecord);
  vi.mocked(queries.updateServiceResourceStatus).mockResolvedValue(fakeRecord.resource);
  vi.mocked(variables.resolveServiceEnv).mockResolvedValue(Result.ok({}));
  vi.mocked(environment.loadPreviewScope).mockResolvedValue(null);
  vi.mocked(spec.buildSwarmSpec).mockResolvedValue(fakeSpec);
}

describe("redeployOne", () => {
  test("returns Ok with an errored runtime when runtime().update throws (env-set 500 fix)", async () => {
    primeCommonMocks();
    const update = vi
      .fn<RuntimeDriver["update"]>()
      .mockRejectedValue(new Error("swarm unreachable"));
    vi.mocked(runtime).mockReturnValue(stubRuntime(update));

    const result = await redeployOne(projectId, resourceId, "proj");

    // The infra throw must NOT propagate. The DB write already succeeded, so
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
    } as const;
    const update = vi.fn<RuntimeDriver["update"]>().mockResolvedValue(runningRuntime);
    vi.mocked(runtime).mockReturnValue(stubRuntime(update));

    const result = await redeployOne(projectId, resourceId, "proj");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.status).toBe("running");
    expect(vi.mocked(queries.updateServiceResourceStatus)).toHaveBeenCalledWith(
      resourceId,
      "valid",
    );
  });
});
