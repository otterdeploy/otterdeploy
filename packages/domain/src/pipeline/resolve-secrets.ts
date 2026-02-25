import { Result } from "better-result";
import { createLogger } from "@otterdeploy/logger";

import type { ResolvedEnvVars } from "./types";

const log = createLogger("pipeline:resolve-secrets");

export interface ResolveSecretsDeps {
  /**
   * Create a deployment secret snapshot (digests of all resolved env vars)
   * and return the resolved plaintext values separated by build-time/runtime.
   */
  createDeploymentSecretSnapshot: (input: {
    deploymentId: string;
    organizationId: string;
    projectId: string;
    environmentId: string;
    resourceId: string;
  }) => Promise<void>;

  /**
   * Resolve all env vars for a resource, merging project -> env -> resource scopes.
   * Returns plain key=value pairs separated by isBuildTime flag.
   */
  resolveEnvVarsForResource: (input: {
    organizationId: string;
    projectId: string;
    environmentId: string;
    resourceId: string;
  }) => Promise<{
    buildTime: Record<string, string>;
    runtime: Record<string, string>;
    all: Record<string, string>;
    snapshotHash: string;
  }>;
}

/**
 * Step 3: Resolve secrets.
 * - Resolves env vars across all scopes (project -> environment -> resource)
 * - Creates a deployment secret snapshot for audit trail
 * - Separates build-time and runtime env vars
 *
 * Idempotent: re-running creates an additional snapshot row (harmless).
 */
export async function resolveSecrets(
  input: {
    deploymentId: string;
    organizationId: string;
    projectId: string;
    environmentId: string;
    resourceId: string;
  },
  deps: ResolveSecretsDeps,
): Promise<Result<ResolvedEnvVars, Error>> {
  try {
    // Create deployment snapshot (audit trail of digests)
    await deps.createDeploymentSecretSnapshot({
      deploymentId: input.deploymentId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      environmentId: input.environmentId,
      resourceId: input.resourceId,
    });

    // Resolve env vars with actual plaintext values for the build
    const resolved = await deps.resolveEnvVarsForResource({
      organizationId: input.organizationId,
      projectId: input.projectId,
      environmentId: input.environmentId,
      resourceId: input.resourceId,
    });

    log.info(
      {
        deploymentId: input.deploymentId,
        buildTimeVarCount: Object.keys(resolved.buildTime).length,
        runtimeVarCount: Object.keys(resolved.runtime).length,
      },
      "Secrets resolved",
    );

    return Result.ok(resolved);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error({ err, deploymentId: input.deploymentId }, "Secret resolution failed");
    return Result.err(err);
  }
}
