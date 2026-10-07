/**
 * The service's own variables, as the image BUILD sees them.
 *
 * Frameworks inline env at build time: Next bakes `NEXT_PUBLIC_*` into
 * prerendered pages, Vite `VITE_*` into the bundle, Nuxt and Astro likewise.
 * Railpack also reads its `RAILPACK_*` overrides (build/start command, package
 * versions) while it plans the build. Runtime env alone reaches none of that:
 * a prerendered page is static, restarting the container does not re-render it.
 *
 * So a Railpack build gets the same resolved bag the container will run with
 * (references, preview overrides and vault values included). Values never ride
 * argv or the on-disk plan: railpack-env.ts declares names only and BuildKit
 * mounts the values as secrets, which keeps them out of every image layer.
 *
 * This module is the DB-facing half (it resolves through the api package, so
 * it pulls a database into its import graph). The shape lives in the pure
 * railpack-env.ts so railpack.ts never imports this file: the same split
 * buildx.ts/turbo-cache.ts make.
 */

import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id-brands";

import { resolveServiceEnvDetailed } from "@otterdeploy/api/lib/variables/resolver";

import type { ServiceBuildEnv } from "./railpack-env";

import { BuildStepError } from "./errors";

/** Masking a two-letter value would scramble unrelated log text (`on`, `1`)
 *  without protecting anything a secret that short could hold. */
const MIN_MASKED_LENGTH = 6;

/**
 * Resolve the service's env for its build: the same bag (and the same preview
 * scoping) the container is started with. An unresolvable bag fails the build
 * here, with the resolver's message: the roll that follows resolves the same
 * bag and would fail on it anyway, after a wasted build.
 */
export async function resolveServiceBuildEnv(opts: {
  projectId: ProjectId;
  serviceResourceId: ResourceId;
  previewId: PreviewId | null;
}) {
  const resolved = await resolveServiceEnvDetailed(
    opts.projectId,
    opts.serviceResourceId,
    opts.previewId,
  );
  return resolved
    .map(
      ({ env, secretKeys }): ServiceBuildEnv => ({
        env,
        secretValues: [...secretKeys]
          .map((key) => env[key] ?? "")
          .filter((value) => value.length >= MIN_MASKED_LENGTH),
      }),
    )
    .mapError((cause) => new BuildStepError({ step: "build-env", cause }));
}
