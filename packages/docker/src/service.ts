import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";


import { getDockerClient } from "./client";
import type {
  CreateServiceOpts,
  UpdateServiceOpts,
  ServiceLogOpts,
  ServiceInfo,
} from "./types";

const log = createLogger("docker:service");

const UPDATE_CONFIG = {
  Parallelism: 1,
  Order: "start-first" as const,
  FailureAction: "rollback" as const,
  Monitor: 30_000_000_000,
  MaxFailureRatio: 0,
};

const ROLLBACK_CONFIG = {
  Parallelism: 1,
  Order: "stop-first" as const,
  FailureAction: "pause" as const,
  Monitor: 15_000_000_000,
  MaxFailureRatio: 0,
};

function buildPortConfig(
  ports?: CreateServiceOpts["ports"],
): Array<{
  TargetPort: number;
  PublishedPort?: number;
  Protocol: string;
  PublishMode: string;
}> {
  if (!ports || ports.length === 0) return [];
  return ports.map((p) => ({
    TargetPort: p.target,
    ...(p.published != null ? { PublishedPort: p.published } : {}),
    Protocol: "tcp",
    PublishMode: "ingress",
  }));
}

function buildMountConfig(
  volumes?: CreateServiceOpts["volumes"],
): Array<{ Source: string; Target: string; Type: string; ReadOnly: boolean }> {
  if (!volumes || volumes.length === 0) return [];
  return volumes.map((v) => ({
    Source: v.source,
    Target: v.target,
    Type: v.type ?? "volume",
    ReadOnly: false,
  }));
}

function buildHealthCheck(healthCheck?: CreateServiceOpts["healthCheck"]) {
  if (!healthCheck) return undefined;
  return {
    Test: ["CMD-SHELL", healthCheck.cmd],
    Interval: healthCheck.interval * 1_000_000_000,
    Timeout: healthCheck.timeout * 1_000_000_000,
    Retries: healthCheck.retries,
  };
}

function buildResourceLimits(
  resourceLimits?: CreateServiceOpts["resourceLimits"],
) {
  if (!resourceLimits) return undefined;
  return {
    Limits: {
      ...(resourceLimits.cpuLimit != null
        ? { NanoCPUs: resourceLimits.cpuLimit * 1_000_000_000 }
        : {}),
      ...(resourceLimits.memoryLimitMb != null
        ? { MemoryBytes: resourceLimits.memoryLimitMb * 1024 * 1024 }
        : {}),
    },
  };
}

function mapRestartPolicy(
  policy?: "always" | "on-failure" | "none",
): string {
  switch (policy) {
    case "always":
      return "any";
    case "on-failure":
      return "on-failure";
    case "none":
      return "none";
    default:
      return "any";
  }
}

export async function createService(
  opts: CreateServiceOpts,
): Promise<Result<string, Error>> {
  const docker = getDockerClient();

  try {
    const networkAttachments = (opts.networks ?? []).map((n) => ({
      Target: n,
    }));

    const serviceSpec = {
      Name: opts.name,
      Labels: opts.labels as Record<string, string>,
      TaskTemplate: {
        ContainerSpec: {
          Image: opts.image,
          Env: opts.env ?? [],
          Mounts: buildMountConfig(opts.volumes),
          HealthCheck: buildHealthCheck(opts.healthCheck),
        },
        Resources: buildResourceLimits(opts.resourceLimits),
        RestartPolicy: {
          Condition: mapRestartPolicy(opts.restartPolicy),
        },
        Networks: networkAttachments,
      },
      Mode: {
        Replicated: {
          Replicas: opts.replicas ?? 1,
        },
      },
      UpdateConfig: UPDATE_CONFIG,
      RollbackConfig: ROLLBACK_CONFIG,
      EndpointSpec: {
        Ports: buildPortConfig(opts.ports),
      },
    };

    const service = await docker.createService(serviceSpec as any);
    log.info({ serviceId: service.id, name: opts.name }, "Service created");
    return Result.ok(service.id);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name: opts.name }, "Failed to create service");
    return Result.err(err);
  }
}

export async function updateService(
  name: string,
  opts: UpdateServiceOpts,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(name);
    const inspection = await service.inspect();
    const currentSpec = inspection.Spec;
    const version = inspection.Version.Index;

    const containerSpec = { ...currentSpec.TaskTemplate.ContainerSpec };
    if (opts.image) containerSpec.Image = opts.image;
    if (opts.env) containerSpec.Env = opts.env;
    if (opts.volumes) containerSpec.Mounts = buildMountConfig(opts.volumes);
    if (opts.healthCheck)
      containerSpec.HealthCheck = buildHealthCheck(opts.healthCheck);

    const taskTemplate = { ...currentSpec.TaskTemplate, ContainerSpec: containerSpec };
    if (opts.resourceLimits)
      taskTemplate.Resources = buildResourceLimits(opts.resourceLimits);
    if (opts.networks)
      taskTemplate.Networks = opts.networks.map((n) => ({ Target: n }));

    const updatedSpec = {
      ...currentSpec,
      TaskTemplate: taskTemplate,
      Labels: opts.labels
        ? { ...currentSpec.Labels, ...opts.labels }
        : currentSpec.Labels,
      Mode:
        opts.replicas != null
          ? { Replicated: { Replicas: opts.replicas } }
          : currentSpec.Mode,
      UpdateConfig: UPDATE_CONFIG,
      RollbackConfig: ROLLBACK_CONFIG,
    };

    if (opts.ports) {
      updatedSpec.EndpointSpec = {
        ...currentSpec.EndpointSpec,
        Ports: buildPortConfig(opts.ports),
      };
    }

    await service.update({ ...updatedSpec, version } as any);
    log.info({ name }, "Service updated");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to update service");
    return Result.err(err);
  }
}

export async function removeService(
  name: string,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(name);
    await service.remove();
    log.info({ name }, "Service removed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to remove service");
    return Result.err(err);
  }
}

export async function inspectService(
  name: string,
): Promise<Result<ServiceInfo, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(name);
    const info = await service.inspect();

    return Result.ok({
      id: info.ID,
      name: info.Spec.Name,
      image: info.Spec.TaskTemplate.ContainerSpec.Image,
      replicas: info.Spec.Mode?.Replicated?.Replicas ?? 0,
      labels: info.Spec.Labels ?? {},
      createdAt: info.CreatedAt,
      updatedAt: info.UpdatedAt,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to inspect service");
    return Result.err(err);
  }
}

export async function listServices(
  labelFilters?: Record<string, string>,
): Promise<Result<ServiceInfo[], Error>> {
  const docker = getDockerClient();

  try {
    const filters: Record<string, string[]> = {};
    if (labelFilters) {
      filters.label = Object.entries(labelFilters).map(
        ([k, v]) => `${k}=${v}`,
      );
    }

    const services = await docker.listServices({ filters });

    const result: ServiceInfo[] = services.map((s: any) => ({
      id: s.ID,
      name: s.Spec.Name,
      image: s.Spec.TaskTemplate.ContainerSpec.Image,
      replicas: s.Spec.Mode?.Replicated?.Replicas ?? 0,
      labels: s.Spec.Labels ?? {},
      createdAt: s.CreatedAt,
      updatedAt: s.UpdatedAt,
    }));

    return Result.ok(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err }, "Failed to list services");
    return Result.err(err);
  }
}

export async function getServiceLogs(
  name: string,
  opts?: ServiceLogOpts,
): Promise<Result<Buffer, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(name);
    const result = await service.logs({
      stdout: opts?.stdout ?? true,
      stderr: opts?.stderr ?? true,
      tail: opts?.tail ?? 100,
      since: opts?.since ?? 0,
      until: opts?.until,
      follow: opts?.follow ?? false,
      timestamps: opts?.timestamps ?? true,
    });

    // Docker's service.logs() with follow:false returns a Buffer directly,
    // not a Readable stream. Handle both cases.
    if (Buffer.isBuffer(result)) {
      return Result.ok(result);
    }

    // follow:true returns a stream — read it into a Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of result as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Result.ok(Buffer.concat(chunks));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name }, "Failed to get service logs");
    return Result.err(err);
  }
}

export async function scaleService(
  name: string,
  replicas: number,
): Promise<Result<void, Error>> {
  const docker = getDockerClient();

  try {
    const service = docker.getService(name);
    const inspection = await service.inspect();
    const version = inspection.Version.Index;
    const currentSpec = inspection.Spec;

    const updatedSpec = {
      ...currentSpec,
      Mode: {
        Replicated: {
          Replicas: replicas,
        },
      },
    };

    await service.update({ ...updatedSpec, version } as any);
    log.info({ name, replicas }, "Service scaled");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, name, replicas }, "Failed to scale service");
    return Result.err(err);
  }
}
