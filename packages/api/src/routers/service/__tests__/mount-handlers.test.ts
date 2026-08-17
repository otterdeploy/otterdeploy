import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../context", () => ({ loadResource: vi.fn() }));
vi.mock("../queries/mounts", () => ({
  listServiceMounts: vi.fn(),
  upsertServiceMount: vi.fn(),
  deleteServiceMount: vi.fn(),
}));
vi.mock("../redeploy", () => ({ redeployAndFanOut: vi.fn() }));

import type { ProjectNotFoundError } from "../../project/errors";
import type { ProjectRow } from "../context";
import type { ResolveError, ServiceNotFoundError } from "../errors";
import type { ResourceRow, ServiceMountRow, ServiceRecord, ServiceResourceRow } from "../queries";

import { loadResource } from "../context";
import { addVolumeMount, listVolumeMounts, removeVolumeMount } from "../mount-handlers";
import { deleteServiceMount, listServiceMounts, upsertServiceMount } from "../queries/mounts";
import { redeployAndFanOut } from "../redeploy";

const projectId = idSchema.project.parse("prj_test");
const resourceId = idSchema.resource.parse("res_test");
const organizationId = idSchema.organization.parse("org_test");
// A real (never-emitted) request logger: the handlers only pass it through to
// the mocked redeploy, so nothing is ever printed.
const log: RequestLogger = createRequestLogger({ method: "TEST", path: "/mounts" });

// ─── typed fixtures ──────────────────────────────────────────────────────
// Complete rows (no partial-object casts): the handlers only read
// `project.slug` and `record.service.serviceName`, but the mocks honor the
// real query signatures so a schema change breaks the test loudly.

const projectRow: ProjectRow = {
  id: projectId,
  organizationId,
  name: "proj",
  slug: "proj",
  environmentId: null,
  stackFile: null,
  stackFileVersion: 0,
  lastAppliedFile: null,
  lastAppliedAt: null,
  manifest: null,
  manifestVersion: 0,
  lastAppliedManifest: null,
  lastManifestAppliedAt: null,
  customDomain: null,
  customDomainVerifiedAt: null,
  customDomainVerifyToken: null,
  nixpacksConfig: null,
  graphLayout: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const resourceRow: ResourceRow = {
  id: resourceId,
  projectId,
  name: "waves",
  type: "service",
  status: "valid",
  environmentId: null,
  previewId: null,
  branchedFromResourceId: null,
  placementServerId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const serviceRow: ServiceResourceRow = {
  resourceId,
  image: "nginx:latest",
  imageDigest: null,
  command: null,
  entrypoint: null,
  extraNetworks: [],
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
  internalHostname: "waves",
  serviceName: "waves",
  networkName: "otterdeploy-proj",
  publicEnabled: false,
  publicDomain: null,
  stackId: null,
  forceUpdateCounter: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const record: ServiceRecord = {
  resource: resourceRow,
  service: serviceRow,
  ports: [],
  env: [],
  mounts: [],
};

let mountSeq = 0;
function makeMountRow(overrides: {
  type: ServiceMountRow["type"];
  target: string;
  source: string | null;
  readOnly?: boolean;
}): ServiceMountRow {
  mountSeq += 1;
  return {
    id: idSchema.serviceMount.parse(`mnt_${mountSeq}`),
    serviceResourceId: resourceId,
    type: overrides.type,
    target: overrides.target,
    source: overrides.source,
    content: null,
    readOnly: overrides.readOnly ?? false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const redeployOk = (): Result<true, ServiceNotFoundError | ResolveError> => Result.ok(true);

beforeEach(() => {
  vi.clearAllMocks();
});

function loaded(): void {
  const ok: Result<
    { project: ProjectRow; record: ServiceRecord },
    ProjectNotFoundError | ServiceNotFoundError
  > = Result.ok({ project: projectRow, record });
  vi.mocked(loadResource).mockResolvedValue(ok);
}

describe("addVolumeMount", () => {
  test("persists a volume-type mount with a derived name, then redeploys", async () => {
    loaded();
    vi.mocked(redeployAndFanOut).mockResolvedValue(redeployOk());
    vi.mocked(upsertServiceMount).mockImplementation(async (input) => ({
      id: idSchema.serviceMount.parse("mnt_upserted"),
      serviceResourceId: input.serviceResourceId,
      type: input.type,
      target: input.target,
      source: input.source,
      content: input.content,
      readOnly: input.readOnly ?? false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));

    const result = await addVolumeMount(
      { projectId, resourceId, organizationId, mountPath: "/data/" },
      log,
    );

    expect(result.isOk()).toBe(true);
    const call = vi.mocked(upsertServiceMount).mock.calls[0]?.[0];
    expect(call?.type).toBe("volume");
    expect(call?.target).toBe("/data"); // normalized
    expect(call?.source).toMatch(/^otterdeploy-vol-waves-/);
    expect(vi.mocked(redeployAndFanOut)).toHaveBeenCalledOnce();
    if (result.isOk()) expect(result.value.mountPath).toBe("/data");
  });
});

describe("removeVolumeMount", () => {
  test("errors when no volume mount exists at that path (no redeploy)", async () => {
    loaded();
    vi.mocked(listServiceMounts).mockResolvedValue([]);
    vi.mocked(redeployAndFanOut).mockResolvedValue(redeployOk());

    const result = await removeVolumeMount(
      { projectId, resourceId, organizationId, mountPath: "/data" },
      log,
    );

    expect(result.isErr()).toBe(true);
    expect(vi.mocked(deleteServiceMount)).not.toHaveBeenCalled();
    expect(vi.mocked(redeployAndFanOut)).not.toHaveBeenCalled();
  });

  test("deletes the matching volume mount and redeploys", async () => {
    loaded();
    vi.mocked(listServiceMounts).mockResolvedValue([
      makeMountRow({ type: "volume", target: "/data", source: "vol", readOnly: false }),
    ]);
    vi.mocked(deleteServiceMount).mockResolvedValue(undefined);
    vi.mocked(redeployAndFanOut).mockResolvedValue(redeployOk());

    const result = await removeVolumeMount(
      { projectId, resourceId, organizationId, mountPath: "/data/" },
      log,
    );

    expect(result.isOk()).toBe(true);
    expect(vi.mocked(deleteServiceMount)).toHaveBeenCalledWith({
      serviceResourceId: resourceId,
      target: "/data",
    });
    expect(vi.mocked(redeployAndFanOut)).toHaveBeenCalledOnce();
  });
});

describe("listVolumeMounts", () => {
  test("returns only volume-type mounts, mapped to the view shape", async () => {
    loaded();
    vi.mocked(listServiceMounts).mockResolvedValue([
      makeMountRow({ type: "volume", target: "/data", source: "vol-a", readOnly: false }),
      makeMountRow({ type: "bind", target: "/etc/x", source: "/host/x", readOnly: true }),
      makeMountRow({ type: "file", target: "/etc/c.json", source: "c.json", readOnly: false }),
    ]);

    const result = await listVolumeMounts({ projectId, resourceId, organizationId });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ mountPath: "/data", volumeName: "vol-a", readOnly: false }]);
    }
  });
});
