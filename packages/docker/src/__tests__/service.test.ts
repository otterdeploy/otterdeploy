import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  createService,
  updateService,
  removeService,
  inspectService,
  listServices,
  scaleService,
} from "../service";
import type { CreateServiceOpts } from "../types";

const baseOpts: CreateServiceOpts = {
  name: "otterstack-svc-123",
  image: "nginx:latest",
  env: ["PORT=3000"],
  ports: [{ target: 80, published: 8080 }],
  networks: ["otterstack-ingress"],
  labels: {
    "otterstack.resource.id": "res-1",
    "otterstack.project.id": "proj-1",
    "otterstack.environment.id": "env-1",
    "otterstack.organization.id": "org-1",
  },
  replicas: 1,
};

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    createService: vi.fn().mockResolvedValue({ id: "svc-abc-123" }),
    getService: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        ID: "svc-abc-123",
        Spec: {
          Name: "otterstack-svc-123",
          TaskTemplate: {
            ContainerSpec: { Image: "nginx:latest", Env: [], Mounts: [] },
            Networks: [],
          },
          Mode: { Replicated: { Replicas: 1 } },
          Labels: {},
          EndpointSpec: { Ports: [] },
        },
        Version: { Index: 5 },
        CreatedAt: "2026-01-01T00:00:00Z",
        UpdatedAt: "2026-01-01T00:00:00Z",
      }),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      logs: vi.fn().mockResolvedValue("log output"),
    }),
    listServices: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("createService", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("creates a service with UpdateConfig and RollbackConfig", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await createService(baseOpts);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe("svc-abc-123");

    const call = (mock.createService as any).mock.calls[0][0];
    expect(call.Name).toBe("otterstack-svc-123");
    expect(call.UpdateConfig.Order).toBe("start-first");
    expect(call.UpdateConfig.FailureAction).toBe("rollback");
    expect(call.UpdateConfig.Monitor).toBe(30_000_000_000);
    expect(call.RollbackConfig.Order).toBe("stop-first");
    expect(call.RollbackConfig.FailureAction).toBe("pause");
    expect(call.RollbackConfig.Monitor).toBe(15_000_000_000);
  });

  it("returns error when docker createService fails", async () => {
    const mock = createMockDocker({
      createService: vi.fn().mockRejectedValue(new Error("service creation failed")),
    });
    setDockerClient(mock);

    const result = await createService(baseOpts);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("service creation failed");
    }
  });

  it("creates service with health check and resource limits", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const opts: CreateServiceOpts = {
      ...baseOpts,
      healthCheck: { cmd: "curl -f http://localhost/health", interval: 10, timeout: 5, retries: 3 },
      resourceLimits: { cpuLimit: 0.5, memoryLimitMb: 512 },
    };

    const result = await createService(opts);
    expect(result.isOk()).toBe(true);

    const call = (mock.createService as any).mock.calls[0][0];
    expect(call.TaskTemplate.ContainerSpec.HealthCheck.Retries).toBe(3);
    expect(call.TaskTemplate.Resources.Limits.NanoCPUs).toBe(500_000_000);
    expect(call.TaskTemplate.Resources.Limits.MemoryBytes).toBe(512 * 1024 * 1024);
  });
});

describe("updateService", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("updates a service image", async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getService: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          ID: "svc-abc-123",
          Spec: {
            Name: "otterstack-svc-123",
            TaskTemplate: {
              ContainerSpec: { Image: "nginx:latest", Env: [], Mounts: [] },
              Networks: [],
            },
            Mode: { Replicated: { Replicas: 1 } },
            Labels: {},
            EndpointSpec: { Ports: [] },
          },
          Version: { Index: 5 },
        }),
        update: mockUpdate,
      }),
    });
    setDockerClient(mock);

    const result = await updateService("otterstack-svc-123", {
      image: "nginx:1.25",
    });

    expect(result.isOk()).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.TaskTemplate.ContainerSpec.Image).toBe("nginx:1.25");
  });
});

describe("removeService", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("removes a service successfully", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getService: vi.fn().mockReturnValue({
        remove: mockRemove,
      }),
    });
    setDockerClient(mock);

    const result = await removeService("otterstack-svc-123");

    expect(result.isOk()).toBe(true);
    expect(mockRemove).toHaveBeenCalled();
  });
});

describe("inspectService", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("returns service info", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await inspectService("otterstack-svc-123");

    expect(result.isOk()).toBe(true);
    const info = result.unwrap();
    expect(info.id).toBe("svc-abc-123");
    expect(info.name).toBe("otterstack-svc-123");
    expect(info.image).toBe("nginx:latest");
  });
});

describe("listServices", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("lists services with label filters", async () => {
    const mock = createMockDocker({
      listServices: vi.fn().mockResolvedValue([
        {
          ID: "svc-1",
          Spec: {
            Name: "otterstack-svc-1",
            TaskTemplate: { ContainerSpec: { Image: "nginx:latest" } },
            Mode: { Replicated: { Replicas: 2 } },
            Labels: { "otterstack.project.id": "proj-1" },
          },
          CreatedAt: "2026-01-01T00:00:00Z",
          UpdatedAt: "2026-01-01T00:00:00Z",
        },
      ]),
    });
    setDockerClient(mock);

    const result = await listServices({ "otterstack.project.id": "proj-1" });

    expect(result.isOk()).toBe(true);
    const services = result.unwrap();
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("otterstack-svc-1");
    expect((mock.listServices as any)).toHaveBeenCalledWith({
      filters: { label: ["otterstack.project.id=proj-1"] },
    });
  });
});

describe("scaleService", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("scales service to specified replicas", async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getService: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          ID: "svc-abc-123",
          Spec: {
            Name: "otterstack-svc-123",
            TaskTemplate: {
              ContainerSpec: { Image: "nginx:latest" },
              Networks: [],
            },
            Mode: { Replicated: { Replicas: 1 } },
            Labels: {},
          },
          Version: { Index: 5 },
        }),
        update: mockUpdate,
      }),
    });
    setDockerClient(mock);

    const result = await scaleService("otterstack-svc-123", 3);

    expect(result.isOk()).toBe(true);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.Mode.Replicated.Replicas).toBe(3);
  });
});
