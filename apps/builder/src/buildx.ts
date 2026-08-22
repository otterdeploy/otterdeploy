/**
 * Persistent BuildKit layer cache via a `docker-container` buildx builder.
 *
 * The default docker driver (host-daemon `buildx --load`) can't EXPORT a
 * BuildKit cache — `--cache-to type=local` is rejected with "Cache export is
 * not supported for the docker driver". A `docker-container` driver builder
 * can, and still `--load`s the result into the host daemon, so we run builds
 * through a shared named one and export/import a local cache under the data
 * folder. The cache (and the builder's instance registration, via
 * `BUILDX_CONFIG` — set in handler.ts) live on the mounted data folder, so they
 * survive the throwaway per-build helper containers and warm later builds.
 *
 * Everything here is BEST-EFFORT: if the builder can't be set up (no docker, no
 * permission, an old docker without buildx), `ensureBuildxBuilder` returns null
 * and the caller builds the original way — default driver, `--load`, no cache.
 * A build NEVER fails because the cache is unavailable.
 */

import { buildxCacheDir } from "@otterdeploy/shared/paths";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { runProcess } from "./run-process";

/** Stable name for the shared cache builder. Its instance metadata is persisted
 *  across helper containers via BUILDX_CONFIG on the mounted data folder, so
 *  after the first build this resolves on the fast `inspect` path. */
const BUILDER_NAME = "otterdeploy-cache";

/** Root for exported BuildKit caches — one subdir per image repo. */
const CACHE_ROOT = buildxCacheDir();

/**
 * Ensure the shared docker-container buildx builder exists and is booted.
 * Returns its name (to pass as `--builder`), or null if it can't be made ready —
 * in which case the caller falls back to the default-driver `--load` build with
 * no cache. Never throws.
 */
export async function ensureBuildxBuilder(sink: LogSink): Promise<string | null> {
  // Already registered (BUILDX_CONFIG persisted it across helpers) — `--bootstrap`
  // restarts the buildkitd container if it was stopped.
  const inspect = await runProcess({
    cmd: "docker",
    args: ["buildx", "inspect", BUILDER_NAME, "--bootstrap"],
    sink,
    echo: false,
  }).catch(() => null);
  if (inspect && inspect.exitCode === 0) return BUILDER_NAME;

  // Not registered for this client yet — create it. If a prior build already
  // created the underlying buildkitd container and it isn't visible here (no
  // persisted BUILDX_CONFIG, e.g. dev), create can conflict; we just fall back
  // to no-cache rather than tear down a possibly-live builder.
  const create = await runProcess({
    cmd: "docker",
    args: [
      "buildx",
      "create",
      "--name",
      BUILDER_NAME,
      "--driver",
      "docker-container",
      "--bootstrap",
    ],
    sink,
    echo: false,
  }).catch(() => null);
  if (create && create.exitCode === 0) return BUILDER_NAME;

  sink.system("buildx cache builder unavailable — building without a persistent layer cache");
  return null;
}

/** Local cache dir for an image repo, e.g.
 *  `<DATA_ROOT>/cache/buildx/ghcr.io_acme_web`. Path-unsafe chars in the repo
 *  (`/`, `:`) collapse to `_` so each repo maps to exactly one dir. */
export function cachePathFor(imageRepository: string): string {
  const safe = imageRepository.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return join(CACHE_ROOT, safe);
}

/** `--builder <name>` when a cache builder is in use, else nothing. PURE. */
export function builderFlags(builderName: string | null | undefined): string[] {
  return builderName ? ["--builder", builderName] : [];
}

/**
 * `--cache-from`/`--cache-to type=local` flags — emitted ONLY when both a
 * docker-container builder and a cache path are present (the default driver
 * rejects cache export, so we must not emit these without the builder). PURE.
 *
 * `noCache` is the per-deploy bypass ("Redeploy without cache"): it drops
 * `--cache-from` so nothing stale is READ, but deliberately keeps `--cache-to`
 * so the run repopulates the cache for the next build. A bypass that also
 * stopped writing would make every subsequent build slow too, which is not what
 * anyone means by "rebuild this one from scratch". The matching `--no-cache`
 * (which invalidates BuildKit's own in-builder cache) is emitted by the
 * callers alongside these flags.
 */
export function cacheFlags(
  builderName: string | null | undefined,
  cachePath: string | null | undefined,
  noCache = false,
): string[] {
  if (!builderName || !cachePath) return [];
  const write = ["--cache-to", `type=local,dest=${cachePath},mode=max`];
  if (noCache) return write;
  return ["--cache-from", `type=local,src=${cachePath}`, ...write];
}

/** `--no-cache` when the deploy asked to bypass the layer cache, else nothing.
 *  Independent of `cacheFlags`: this one applies to the default driver too,
 *  where there is no local cache to import or export. PURE. */
export function noCacheFlags(noCache: boolean | null | undefined): string[] {
  return noCache ? ["--no-cache"] : [];
}

/**
 * Turbo credentials for one build: values to expose to the build process and
 * the matching buildx `--secret` flags.
 *
 * The SHAPE lives here, next to the other cache flags, rather than in
 * turbo-cache.ts. That module resolves the service's encrypted variables and
 * therefore imports the db, and railpack.ts must not drag a database
 * connection into its module graph just to name a type — doing so broke
 * builder unit tests that have no DATABASE_URL.
 */
export interface TurboCacheEnv {
  /** Keys → values to expose to the build process, empty when disabled. */
  env: Record<string, string>;
  /** `--secret id=KEY,env=KEY` flags for buildx. */
  secretFlags: string[];
}

/** No turbo credentials: the shape every disabled/failed lookup returns. */
export const NO_TURBO_CACHE: TurboCacheEnv = { env: {}, secretFlags: [] };

/**
 * `TURBO_FORCE=1` when the deploy asked to bypass caches.
 *
 * The per-deploy bypass is one flag across every layer: buildx gets
 * `--no-cache` plus a dropped `--cache-from`, and turbo gets this, which makes
 * it re-run every task instead of restoring outputs from the (local or remote)
 * cache. Without it a "rebuild without cache" would still hydrate the app's
 * build output straight out of the turbo cache, which is exactly what the
 * operator was trying to rule out. PURE.
 */
export function turboForceEnv(noCache: boolean | null | undefined): Record<string, string> {
  return noCache ? { TURBO_FORCE: "1" } : {};
}
