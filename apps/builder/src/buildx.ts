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

import { join } from "node:path";

import { DATA_ROOT } from "@otterdeploy/shared/paths";

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

/** Stable name for the shared cache builder. Its instance metadata is persisted
 *  across helper containers via BUILDX_CONFIG on the mounted data folder, so
 *  after the first build this resolves on the fast `inspect` path. */
const BUILDER_NAME = "otterdeploy-cache";

/** Root for exported BuildKit caches — one subdir per image repo. */
const CACHE_ROOT = join(DATA_ROOT, "buildx-cache");

/**
 * Ensure the shared docker-container buildx builder exists and is booted.
 * Returns its name (to pass as `--builder`), or null if it can't be made ready —
 * in which case the caller falls back to the default-driver `--load` build with
 * no cache. Never throws.
 */
export async function ensureBuildxBuilder(
  sink: LogSink,
): Promise<string | null> {
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

  sink.system(
    "buildx cache builder unavailable — building without a persistent layer cache",
  );
  return null;
}

/** Local cache dir for an image repo, e.g.
 *  `<DATA_ROOT>/buildx-cache/ghcr.io_acme_web`. Path-unsafe chars in the repo
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
 */
export function cacheFlags(
  builderName: string | null | undefined,
  cachePath: string | null | undefined,
): string[] {
  if (!builderName || !cachePath) return [];
  return [
    "--cache-from",
    `type=local,src=${cachePath}`,
    "--cache-to",
    `type=local,dest=${cachePath},mode=max`,
  ];
}
