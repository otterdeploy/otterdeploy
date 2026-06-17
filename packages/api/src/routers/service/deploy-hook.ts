/**
 * Deploy-hook context resolution.
 *
 * Pre/post-deploy hooks run as throwaway containers off the freshly-built
 * image. To behave like the service itself — reach the project's database by
 * its network alias, see the same resolved env — a hook must run on the same
 * project network with the same env the running container gets. This resolves
 * both, reusing `resolveServiceEnv` (so `${{db.DATABASE_URL}}`-style refs are
 * expanded identically) and the driver's network-naming rule.
 *
 * The builder owns the actual container run (it holds the deployment-log sink
 * and the docker socket); it calls this for the env + network only.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import { PLATFORM } from "../../constants";
import { resolveServiceEnv } from "../../lib/variables";

import type { RefMissingResourceError, ResolveError } from "./errors";
import { sanitizeSlug } from "./views";

export interface DeployHookContext {
  /** Resolved env the hook container runs with — identical to the service's. */
  env: Record<string, string>;
  /** Project network the hook joins, so service/DB aliases resolve. Matches
   *  the name both runtime drivers use (`<prefix><sanitized-slug>`). */
  networkName: string;
}

async function resolveDeployHookContext(
  projectId: ProjectId,
  resourceId: ResourceId,
  projectSlug: string,
): Promise<Result<DeployHookContext, ResolveError | RefMissingResourceError>> {
  const resolved = await resolveServiceEnv(projectId, resourceId);
  if (resolved.isErr()) return Result.err(resolved.error);
  return Result.ok({
    env: resolved.value,
    networkName: `${PLATFORM.swarm.networkPrefix}${sanitizeSlug(projectSlug)}`,
  });
}
