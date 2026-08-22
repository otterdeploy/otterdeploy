/**
 * Turborepo Remote Cache credentials for a build.
 *
 * Of the three caches in play this is the only one that needs no BuildKit
 * surgery: turbo talks to the cache over HTTP, so enabling it is purely a
 * matter of getting `TURBO_TOKEN` (+ `TURBO_TEAM` / `TURBO_API`) into the
 * build environment. The other two are the BuildKit layer cache (already
 * handled by buildx.ts) and turbo's local `.turbo` dir (not persistable: the
 * work dir is recreated per deployment, and the layer cache already covers
 * "inputs unchanged → skip").
 *
 * The token is a real secret, so it must NOT ride `buildArgs`: those become
 * `--build-arg` and land in the image history for anyone who pulls the image
 * (see BuildDockerfileConfig). It goes through buildx `--secret` instead,
 * exactly like RAILPACK_SPA_OUTPUT_DIR and NODE_OPTIONS already do — mounted
 * for the build step, absent from every layer.
 *
 * Values come from the service's OWN env vars rather than a new settings
 * field: TURBO_TOKEN is already a secret users store that way, it inherits the
 * existing encryption/sealing/preview-override behavior, and it keeps
 * credentials out of the manifest (which is committed to repos).
 */

import type { PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id-brands";

import { resolveServiceEnv } from "@otterdeploy/api/lib/variables/resolver";

import type { LogSink } from "./log-stream";

import { NO_TURBO_CACHE, type TurboCacheEnv } from "./buildx";

/** Env keys forwarded to the build when the remote cache is enabled. Only
 *  turbo's own credentials; nothing else from the service env crosses into the
 *  build environment. */
const TURBO_CACHE_KEYS = ["TURBO_TOKEN", "TURBO_TEAM", "TURBO_API"] as const;

/** Turbo refuses to use the remote cache without a token; team/api are
 *  optional (self-hosted caches often need only the API URL + token). */
const REQUIRED_KEY = "TURBO_TOKEN";

/**
 * Collect the turbo remote-cache credentials for a build, or nothing when the
 * feature is off / the service has no token configured.
 *
 * Never throws and never fails a build: the remote cache is a pure speedup, so
 * a missing token or an unresolvable env bag degrades to a local build with a
 * log line, the same contract `ensureBuildxBuilder` has for the layer cache.
 */
export async function resolveTurboCacheEnv(opts: {
  enabled: boolean | null | undefined;
  projectId: ProjectId;
  serviceResourceId: ResourceId;
  previewId: PreviewId | null;
  sink: LogSink;
}): Promise<TurboCacheEnv> {
  if (!opts.enabled) return NO_TURBO_CACHE;

  const resolved = await resolveServiceEnv(
    opts.projectId,
    opts.serviceResourceId,
    // Pass the preview through so a preview's own TURBO_TOKEN override wins,
    // exactly as it would at runtime.
    opts.previewId,
  );
  if (resolved.isErr()) {
    opts.sink.system(
      "turbo remote cache is enabled but the service env could not be resolved; building without it",
    );
    return NO_TURBO_CACHE;
  }

  const env: Record<string, string> = {};
  for (const key of TURBO_CACHE_KEYS) {
    const value = resolved.value[key]?.trim();
    if (value) env[key] = value;
  }

  if (!env[REQUIRED_KEY]) {
    opts.sink.system(
      `turbo remote cache is enabled but no ${REQUIRED_KEY} is set on this service; building without it. ` +
        `Add ${REQUIRED_KEY} (and ${TURBO_CACHE_KEYS.slice(1).join(" / ")} if your cache needs them) as service variables.`,
    );
    return NO_TURBO_CACHE;
  }

  const keys = Object.keys(env);
  opts.sink.system(`turbo remote cache enabled (${keys.join(", ")})`);
  return { env, secretFlags: keys.flatMap((k) => ["--secret", `id=${k},env=${k}`]) };
}
