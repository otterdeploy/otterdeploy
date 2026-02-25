/**
 * Concrete dependency wiring for deployment pipeline steps.
 *
 * Each pipeline step in @otterdeploy/domain/pipeline accepts its dependencies
 * via typed interfaces. This module creates the real implementations that connect
 * to the database, Docker, Git, Builder, Proxy, and Secrets packages.
 */
import { db, eq, and, or } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/deployment";
import { resource, project, environment } from "@otterdeploy/db/schema/project";
import { gitRepository } from "@otterdeploy/db/schema/infrastructure";
import { customDomain } from "@otterdeploy/db/schema/operations";
import { deploymentMachine, deploymentSecretService } from "@otterdeploy/domain";
import { Result } from "better-result";

import type {
  PipelineDeps,
  CloneSourceDeps,
  ResolveSecretsDeps,
  BuildDeps,
  PreDeployDeps,
  DeployDeps,
  HealthCheckDeps,
  RouteTrafficDeps,
  VerifyDeps,
  CleanupDeps,
} from "@otterdeploy/domain/pipeline";

/**
 * Create the core pipeline dependencies that provide DB access and deployment transitions.
 */
export function createPipelineDeps(): PipelineDeps {
  return {
    getDeployment: async (id) => {
      const row = await db.query.deployment.findFirst({
        where: eq(deployment.id, id),
      });
      if (!row) return null;
      return {
        id: row.id,
        organizationId: row.organizationId,
        projectId: row.projectId,
        environmentId: row.environmentId,
        resourceId: row.resourceId,
        status: row.status,
        source: row.source,
        builder: row.builder,
        imageTag: row.imageTag,
        previousImageTag: row.previousImageTag,
        gitRef: row.gitRef,
        gitCommitSha: row.gitCommitSha,
        triggeredBy: row.triggeredBy,
      };
    },

    getResource: async (id) => {
      const row = await db.query.resource.findFirst({
        where: eq(resource.id, id),
        with: { runtimeConfig: true, buildConfig: true },
      });
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        port: row.runtimeConfig?.port ?? null,
        healthCheckPath: row.runtimeConfig?.healthCheckPath ?? null,
        healthCheckInterval: row.runtimeConfig?.healthCheckInterval ?? null,
        healthCheckTimeout: row.runtimeConfig?.healthCheckTimeout ?? null,
        replicas: row.runtimeConfig?.replicas ?? null,
        cpuLimit: row.runtimeConfig?.cpuLimit ?? null,
        memoryLimit: row.runtimeConfig?.memoryLimit ?? null,
        startCommand: row.runtimeConfig?.startCommand ?? null,
        preDeployCommand: row.buildConfig?.preDeployCommand ?? null,
        restartPolicy: row.runtimeConfig?.restartPolicy ?? null,
        restartPolicyMaxRetries: row.runtimeConfig?.restartPolicyMaxRetries ?? null,
        builder: row.buildConfig?.builder ?? null,
        dockerfilePath: row.buildConfig?.dockerfilePath ?? null,
        buildCommand: row.buildConfig?.buildCommand ?? null,
        serverId: row.serverId,
      };
    },

    getProject: async (id) => {
      const row = await db.query.project.findFirst({
        where: eq(project.id, id),
      });
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        baseDomain: row.baseDomain,
        organizationId: row.organizationId,
      };
    },

    getEnvironment: async (id) => {
      const row = await db.query.environment.findFirst({
        where: eq(environment.id, id),
      });
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        projectId: row.projectId,
      };
    },

    getGitRepository: async (resourceId) => {
      const row = await db.query.gitRepository.findFirst({
        where: eq(gitRepository.resourceId, resourceId),
      });
      if (!row) return null;
      return {
        owner: row.owner,
        name: row.name,
        branch: row.branch,
        rootDirectory: row.rootDirectory,
        gitProviderId: row.gitProviderId,
        // Access token will be resolved separately when needed
      };
    },

    getActiveDeploymentsForResource: async (resourceId, excludeDeploymentId) => {
      const rows = await db.query.deployment.findMany({
        where: and(
          eq(deployment.resourceId, resourceId),
          or(
            eq(deployment.status, "building"),
            eq(deployment.status, "deploying"),
            eq(deployment.status, "verifying"),
          ),
        ),
      });
      return rows
        .filter((r) => r.id !== excludeDeploymentId)
        .map((r) => ({ id: r.id, status: r.status }));
    },

    getResourceDomains: async (resourceId) => {
      const rows = await db.query.customDomain.findMany({
        where: eq(customDomain.resourceId, resourceId),
      });
      return rows.map((r) => ({ domain: r.domain, verified: r.verified }));
    },

    getResourcePort: async (resourceId) => {
      const row = await db.query.resource.findFirst({
        where: eq(resource.id, resourceId),
        with: { runtimeConfig: true },
      });
      return row?.runtimeConfig?.port ?? 3000;
    },

    transitionTo: async (deploymentId, status, eventData) => {
      const result = await deploymentMachine.transitionTo(
        deploymentId,
        status as Parameters<typeof deploymentMachine.transitionTo>[1],
        eventData,
      );
      if (result.isErr()) {
        return Result.err(
          result.error instanceof Error
            ? result.error
            : new Error(String(result.error)),
        );
      }
      return Result.ok(undefined);
    },

    updateDeployment: async (deploymentId, data) => {
      const updateSet: Record<string, unknown> = {};
      if (data.imageTag !== undefined) updateSet.imageTag = data.imageTag;
      if (data.previousImageTag !== undefined) updateSet.previousImageTag = data.previousImageTag;
      updateSet.updatedAt = new Date();

      await db
        .update(deployment)
        .set(updateSet)
        .where(eq(deployment.id, deploymentId));
    },
  };
}

/**
 * Create clone step dependencies.
 * Uses @otterdeploy/git cloneRepository.
 */
export function createCloneDeps(): CloneSourceDeps {
  return {
    cloneRepository: async (opts) => {
      // Dynamic import to avoid hard dependency at module level
      const { cloneRepository } = await import("@otterdeploy/git");
      return cloneRepository(opts);
    },
  };
}

/**
 * Create resolve-secrets step dependencies.
 * Uses @otterdeploy/domain deployment-secret service.
 */
export function createResolveSecretsDeps(): ResolveSecretsDeps {
  return {
    createDeploymentSecretSnapshot: async (input) => {
      await deploymentSecretService.createDeploymentSecretSnapshot(input);
    },

    resolveEnvVarsForResource: async (input) => {
      const { environmentVariable } = await import("@otterdeploy/db/schema/operations");
      const rows = await db.query.environmentVariable.findMany({
        where: and(
          eq(environmentVariable.organizationId, input.organizationId),
          or(
            eq(environmentVariable.projectId, input.projectId),
            eq(environmentVariable.environmentId, input.environmentId),
            eq(environmentVariable.resourceId, input.resourceId),
          ),
        ),
      });

      // Determine scope from which FK is set
      function scopeOf(row: typeof rows[number]): "project" | "environment" | "resource" {
        if (row.resourceId) return "resource";
        if (row.environmentId) return "environment";
        return "project";
      }

      // Merge by key with scope priority: project < environment < resource
      const scopeWeight = { project: 0, environment: 1, resource: 2 } as const;
      const merged = new Map<string, typeof rows[number]>();
      const sorted = [...rows].sort(
        (a, b) => scopeWeight[scopeOf(a)] - scopeWeight[scopeOf(b)],
      );
      for (const row of sorted) {
        merged.set(row.key, row);
      }

      const buildTime: Record<string, string> = {};
      const runtime: Record<string, string> = {};
      const all: Record<string, string> = {};

      const { decodeLegacySecret } = await import("@otterdeploy/domain/legacy-secret");

      for (const row of merged.values()) {
        const value = decodeLegacySecret(row.encryptedValue);
        all[row.key] = value;
        if (row.isBuildTime) {
          buildTime[row.key] = value;
        } else {
          runtime[row.key] = value;
        }
      }

      // Compute a simple snapshot hash
      const { createHash } = await import("node:crypto");
      const hashInput = Object.entries(all)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      const snapshotHash = createHash("sha256").update(hashInput).digest("hex");

      return { buildTime, runtime, all, snapshotHash };
    },
  };
}

/**
 * Create build step dependencies.
 * Uses @otterdeploy/builder for image building and tagging.
 */
export function createBuildDeps(): BuildDeps {
  return {
    buildImage: async (input) => {
      const { getBuilder, getImageName, getImageTag } = await import("@otterdeploy/builder");
      const method = "nixpacks"; // Default; the pipeline step determines the actual method
      const builder = getBuilder(method);
      const result = await builder.build(input);
      if (result.isErr()) return result;
      return Result.ok({
        imageName: result.value.imageName,
        imageTag: result.value.imageTag,
        durationMs: result.value.durationMs,
      });
    },

    tagAsLatest: async (resourceId, deploymentNumber) => {
      const { tagAsLatest } = await import("@otterdeploy/builder");
      return tagAsLatest(resourceId, deploymentNumber);
    },

    updateDeployment: createPipelineDeps().updateDeployment,
  };
}

/**
 * Create pre-deploy step dependencies.
 * Uses @otterdeploy/docker for running one-off containers.
 */
export function createPreDeployDeps(): PreDeployDeps {
  return {
    runOneOffContainer: async (input) => {
      const docker = await import("@otterdeploy/docker");
      // Create a temporary service, wait for it to complete, then remove it
      const containerName = `otterstack-predeploy-${Date.now()}`;

      const createResult = await docker.createService({
        name: containerName,
        image: input.image,
        env: input.env,
        labels: {
          "otterstack.resource.id": "predeploy",
          "otterstack.project.id": "predeploy",
          "otterstack.environment.id": "predeploy",
          "otterstack.organization.id": "predeploy",
          "otterstack.predeploy": "true",
        },
        restartPolicy: "none",
        replicas: 1,
      });

      if (createResult.isErr()) {
        return Result.err(createResult.error);
      }

      // Poll for completion
      const timeoutMs = input.timeoutMs ?? 300_000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const containers = await docker.listContainers(containerName);
        if (containers.isOk()) {
          const list = containers.value;
          const exited = list.find(
            (c) => c.state === "exited" || c.state === "complete",
          );
          if (exited) {
            // Clean up the service
            await docker.removeService(containerName);
            return Result.ok({ exitCode: 0, output: exited.status });
          }
          const failed = list.find((c) => c.state === "dead");
          if (failed) {
            await docker.removeService(containerName);
            return Result.ok({ exitCode: 1, output: failed.status });
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }

      // Timeout - clean up
      await docker.removeService(containerName);
      return Result.err(new Error(`Pre-deploy command timed out after ${timeoutMs}ms`));
    },
  };
}

/**
 * Create deploy step dependencies.
 * Uses @otterdeploy/docker for Swarm service management.
 */
export function createDeployDeps(): DeployDeps {
  return {
    createService: async (opts) => {
      const docker = await import("@otterdeploy/docker");
      return docker.createService(opts as Parameters<typeof docker.createService>[0]);
    },

    updateService: async (name, opts) => {
      const docker = await import("@otterdeploy/docker");
      return docker.updateService(name, opts);
    },

    inspectService: async (name) => {
      const docker = await import("@otterdeploy/docker");
      const result = await docker.inspectService(name);
      if (result.isErr()) {
        // Service not found is not an error for our purposes
        if (result.error.message.includes("not found") || result.error.message.includes("404")) {
          return Result.ok(null);
        }
        return result;
      }
      return Result.ok({ id: result.value.id });
    },

    transitionTo: createPipelineDeps().transitionTo,
  };
}

/**
 * Create health-check step dependencies.
 */
export function createHealthCheckDeps(): HealthCheckDeps {
  return {
    listContainers: async (serviceFilter) => {
      const docker = await import("@otterdeploy/docker");
      return docker.listContainers(serviceFilter);
    },

    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * Create route-traffic step dependencies.
 */
export function createRouteTrafficDeps(pipelineDeps: PipelineDeps): RouteTrafficDeps {
  return {
    syncResourceProxy: async (resourceId, syncDeps) => {
      const proxy = await import("@otterdeploy/proxy");
      return proxy.syncResourceProxy(resourceId, {
        getResourceDomains: syncDeps.getResourceDomains,
        getResourcePort: syncDeps.getResourcePort,
        getAllResources: async () => [], // Not needed for single-resource sync
      });
    },

    getResourceDomains: pipelineDeps.getResourceDomains,
    getResourcePort: pipelineDeps.getResourcePort,
  };
}

/**
 * Create verify step dependencies.
 */
export function createVerifyDeps(): VerifyDeps {
  return {
    transitionTo: createPipelineDeps().transitionTo,

    publishDeploymentReleased: async (input) => {
      const { publishEvent } = await import("@otterdeploy/events");
      const result = await publishEvent("deployment.released", {
        orgId: input.orgId,
        deploymentId: input.deploymentId,
        resourceId: input.resourceId,
        environmentId: input.environmentId,
        status: "live",
        releasedUrl: input.releasedUrl,
        correlationId: input.correlationId,
      });
      if (result.isErr()) {
        return Result.err(
          result.error instanceof Error
            ? result.error
            : new Error(String(result.error)),
        );
      }
      return Result.ok(undefined);
    },
  };
}

/**
 * Create cleanup step dependencies.
 */
export function createCleanupDeps(): CleanupDeps {
  return {
    removeDirectory: async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    },

    pruneOldTags: async (resourceId, keep) => {
      const { pruneOldTags } = await import("@otterdeploy/builder");
      return pruneOldTags(resourceId, keep);
    },
  };
}
