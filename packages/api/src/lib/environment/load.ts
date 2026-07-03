/**
 * Load an `EnvScope` (the naming/scoping subset) from an environment id. The DB
 * companion to the pure rules in `./scoping`. Used by the deploy path + the
 * builder to decide whether a deployment is a preview (env-scoped names + image
 * override) or a normal persistent-env deploy.
 */
import type { EnvironmentId } from "@otterdeploy/shared/id";

import { getEnvironmentById } from "../../routers/project/queries";
import { type EnvScope } from "./scoping";

export async function loadEnvScope(
  environmentId: EnvironmentId | null | undefined,
): Promise<EnvScope | null> {
  if (!environmentId) return null;
  const env = await getEnvironmentById(environmentId);
  if (!env) return null;
  return {
    id: env.id,
    kind: env.kind,
    slug: env.slug,
    pullRequestNumber: env.pullRequestNumber,
  };
}
