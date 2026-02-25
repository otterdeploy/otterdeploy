import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { PipelineDeps, ResourceConfig, ProjectConfig, EnvironmentConfig } from "./types";

const log = createLogger("pipeline:deploy");

export interface DeployDeps {
  /**
   * Create a new Swarm service.
   */
  createService: (opts: {
    name: string;
    image: string;
    env?: string[];
    ports?: Array<{ target: number; published?: number }>;
    volumes?: Array<{ source: string; target: string; type?: "volume" | "bind" }>;
    networks?: string[];
    labels: Record<string, string>;
    healthCheck?: { cmd: string; interval: number; timeout: number; retries: number };
    restartPolicy?: "always" | "on-failure" | "none";
    resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
    replicas?: number;
  }) => Promise<Result<string, Error>>;

  /**
   * Update an existing Swarm service.
   */
  updateService: (
    name: string,
    opts: {
      image?: string;
      env?: string[];
      ports?: Array<{ target: number; published?: number }>;
      volumes?: Array<{ source: string; target: string; type?: "volume" | "bind" }>;
      networks?: string[];
      labels?: Record<string, string>;
      healthCheck?: { cmd: string; interval: number; timeout: number; retries: number };
      resourceLimits?: { cpuLimit?: number; memoryLimitMb?: number };
      replicas?: number;
    },
  ) => Promise<Result<void, Error>>;

  /**
   * Inspect an existing service. Returns null if not found.
   */
  inspectService: (name: string) => Promise<Result<{ id: string } | null, Error>>;

  /**
   * Transition the deployment to a new status.
   */
  transitionTo: PipelineDeps["transitionTo"];
}

/**
 * Step 6: Deploy to Docker Swarm.
 * - Transitions building -> deploying
 * - Checks if the Swarm service already exists (update vs create)
 * - Builds full service spec with update/rollback config
 * - Connects to project network + ingress
 *
 * Idempotent: if the service already exists with the same image, update is a no-op
 * from Docker's perspective.
 */
export async function deploySwarmService(
  input: {
    deploymentId: string;
    fullImage: string;
    runtimeEnv: Record<string, string>;
    resource: ResourceConfig;
    project: ProjectConfig;
    environment: EnvironmentConfig;
    organizationId: string;
    actorUserId: string;
  },
  deps: DeployDeps,
): Promise<Result<void, Error>> {
  try {
    const {
      deploymentId,
      fullImage,
      runtimeEnv,
      resource,
      project,
      environment,
      organizationId,
    } = input;

    // Transition building -> deploying
    const transitionResult = await deps.transitionTo(deploymentId, "deploying", {
      actor: "system",
      reason: "Deploy started",
    });
    if (transitionResult.isErr()) {
      return Result.err(
        transitionResult.error instanceof Error
          ? transitionResult.error
          : new Error(String(transitionResult.error)),
      );
    }

    const serviceName = `otterstack-${resource.id}`;
    const envArray = Object.entries(runtimeEnv).map(([k, v]) => `${k}=${v}`);
    const projectNetworkName = `otterstack-${project.id}`;

    const labels: Record<string, string> = {
      "otterstack.resource.id": resource.id,
      "otterstack.project.id": project.id,
      "otterstack.environment.id": environment.id,
      "otterstack.organization.id": organizationId,
      "otterstack.deployment.id": deploymentId,
      "otterstack.managed": "true",
    };

    const ports: Array<{ target: number; published?: number }> = [];
    if (resource.port) {
      ports.push({ target: resource.port });
    }

    const healthCheck = resource.healthCheckPath
      ? {
          cmd: `curl -f http://localhost:${resource.port ?? 3000}${resource.healthCheckPath} || exit 1`,
          interval: resource.healthCheckInterval ?? 30,
          timeout: resource.healthCheckTimeout ?? 10,
          retries: 3,
        }
      : undefined;

    const restartPolicy = mapRestartPolicy(resource.restartPolicy);

    const resourceLimits =
      resource.cpuLimit || resource.memoryLimit
        ? {
            cpuLimit: resource.cpuLimit ?? undefined,
            memoryLimitMb: resource.memoryLimit ?? undefined,
          }
        : undefined;

    // Check if service exists
    const inspectResult = await deps.inspectService(serviceName);
    const serviceExists = inspectResult.isOk() && inspectResult.value !== null;

    if (serviceExists) {
      // Update existing service (blue-green via start-first update config)
      log.info({ deploymentId, serviceName }, "Updating existing service");

      const updateResult = await deps.updateService(serviceName, {
        image: fullImage,
        env: envArray,
        ports,
        networks: [projectNetworkName, "otterstack-ingress"],
        labels,
        healthCheck,
        resourceLimits,
        replicas: resource.replicas ?? 1,
      });

      if (updateResult.isErr()) {
        return Result.err(updateResult.error);
      }
    } else {
      // Create new service
      log.info({ deploymentId, serviceName }, "Creating new service");

      const createResult = await deps.createService({
        name: serviceName,
        image: fullImage,
        env: envArray,
        ports,
        networks: [projectNetworkName, "otterstack-ingress"],
        labels,
        healthCheck,
        restartPolicy,
        resourceLimits,
        replicas: resource.replicas ?? 1,
      });

      if (createResult.isErr()) {
        return Result.err(createResult.error);
      }
    }

    log.info({ deploymentId, serviceName, fullImage }, "Service deployed");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Deploy failed");
    return Result.err(err);
  }
}

function mapRestartPolicy(
  policy: ResourceConfig["restartPolicy"],
): "always" | "on-failure" | "none" {
  switch (policy) {
    case "ALWAYS":
      return "always";
    case "ON_FAILURE":
      return "on-failure";
    case "NEVER":
      return "none";
    default:
      return "always";
  }
}
