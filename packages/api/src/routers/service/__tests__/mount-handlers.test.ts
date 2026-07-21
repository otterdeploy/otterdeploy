import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../context", () => ({ loadResource: vi.fn() }));
vi.mock("../queries/mounts", () => ({
  listServiceMounts: vi.fn(),
  upsertServiceMount: vi.fn(),
  deleteServiceMount: vi.fn(),
}));
vi.mock("../redeploy", () => ({ redeployAndFanOut: vi.fn() }));

import { loadResource } from "../context";
import { addVolumeMount, listVolumeMounts, removeVolumeMount } from "../mount-handlers";
import { deleteServiceMount, listServiceMounts, upsertServiceMount } from "../queries/mounts";
import { redeployAndFanOut } from "../redeploy";

const projectId = "project_test" as ProjectId;
const resourceId = "resource_test" as ResourceId;
const organizationId = "org_test" as never;
const log = { set: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

function loaded(): void {
  vi.mocked(loadResource).mockResolvedValue(
    Result.ok({
      project: { slug: "proj" },
      record: { service: { serviceName: "waves" } },
    }) as never,
  );
}

describe("addVolumeMount", () => {
  test("persists a volume-type mount with a derived name, then redeploys", async () => {
    loaded();
    vi.mocked(redeployAndFanOut).mockResolvedValue(Result.ok(true) as never);
    vi.mocked(upsertServiceMount).mockImplementation(
      async (input) => ({ ...input, id: "mnt_1", content: null }) as never,
    );

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
    vi.mocked(redeployAndFanOut).mockResolvedValue(Result.ok(true) as never);

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
      { type: "volume", target: "/data", source: "vol", readOnly: false } as never,
    ]);
    vi.mocked(deleteServiceMount).mockResolvedValue(undefined as never);
    vi.mocked(redeployAndFanOut).mockResolvedValue(Result.ok(true) as never);

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
      { type: "volume", target: "/data", source: "vol-a", readOnly: false } as never,
      { type: "bind", target: "/etc/x", source: "/host/x", readOnly: true } as never,
      { type: "file", target: "/etc/c.json", source: "c.json", readOnly: false } as never,
    ]);

    const result = await listVolumeMounts({ projectId, resourceId, organizationId });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ mountPath: "/data", volumeName: "vol-a", readOnly: false }]);
    }
  });
});
