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
 * Dedicated docker network for the buildkitd container.
 *
 * Created for two independent reasons, either of which would justify it:
 *
 *   1. DNS. On the DEFAULT bridge a container gets a filtered copy of the
 *      host's `/etc/resolv.conf`; when the host resolves through a loopback
 *      stub (systemd-resolved on 127.0.0.53) docker strips it and falls back
 *      to a public resolver the box may not be able to reach. The host itself
 *      is fine, so `docker pull` works and the BUILDER times out resolving
 *      `registry-1.docker.io` — exactly the reported failure (od-jgn3). A
 *      user-defined network instead gets docker's embedded resolver at
 *      127.0.0.11, which is the standard remedy for "the host resolves and the
 *      container does not".
 *   2. Isolation. buildkitd's OCI worker runs RUN steps in its own netns, so a
 *      tenant Dockerfile reaches whatever buildkitd reaches. On the shared
 *      compose network that is postgres, redis and the control plane
 *      (od-5j8.36). Its own network is the fix that issue asks for.
 *
 * NOT `--internal`: builds must reach registries. This narrows what the build
 * sandbox can talk to on the LAN, it is not an egress lock.
 *
 * The obvious alternative, `--driver-opt network=host`, would fix (1) and make
 * (2) strictly worse, which is why it is not used despite being the usual
 * advice.
 */
const BUILD_NETWORK = "otterdeploy-build";

/**
 * Create the build network if it is missing. Returns whether it can be used.
 *
 * Best-effort: a builder on the default bridge is what every install has today,
 * so failing to create the network must degrade to that rather than stop the
 * build. Never throws.
 */
async function ensureBuildNetwork(sink: LogSink): Promise<boolean> {
  const existing = await runProcess({
    cmd: "docker",
    args: ["network", "inspect", BUILD_NETWORK],
    sink,
    echo: false,
  }).catch(() => null);
  if (existing && existing.exitCode === 0) return true;

  const created = await runProcess({
    cmd: "docker",
    args: ["network", "create", BUILD_NETWORK],
    sink,
    echo: false,
  }).catch(() => null);
  // A concurrent build may have created it between the two calls; that races to
  // a non-zero exit here and is not a failure.
  if (created && created.exitCode === 0) return true;

  const recheck = await runProcess({
    cmd: "docker",
    args: ["network", "inspect", BUILD_NETWORK],
    sink,
    echo: false,
  }).catch(() => null);
  return recheck !== null && recheck.exitCode === 0;
}

/**
 * Ensure the shared docker-container buildx builder exists and is booted.
 * Returns its name (to pass as `--builder`), or null if it can't be made ready —
 * in which case the caller falls back to the default-driver `--load` build with
 * no cache. Never throws.
 */

/**
 * Is the existing buildkitd container attached to the build network?
 *
 * Answering "no" for a builder we cannot inspect is deliberate: a false "yes"
 * leaves a broken builder in place forever, while a false "no" costs one
 * recreate. The asymmetry is the whole reason this is not `?? true`.
 */
async function builderIsOnBuildNetwork(sink: LogSink): Promise<boolean> {
  const container = `buildx_buildkit_${BUILDER_NAME}0`;
  const inspected = await runProcess({
    cmd: "docker",
    args: ["inspect", container, "--format", "{{json .NetworkSettings.Networks}}"],
    sink,
    echo: false,
  }).catch(() => null);
  if (!inspected || inspected.exitCode !== 0) return false;
  return inspected.tail.includes(`"${BUILD_NETWORK}"`);
}

export async function ensureBuildxBuilder(sink: LogSink): Promise<string | null> {
  // Already registered (BUILDX_CONFIG persisted it across helpers) — `--bootstrap`
  // restarts the buildkitd container if it was stopped.
  const inspect = await runProcess({
    cmd: "docker",
    args: ["buildx", "inspect", BUILDER_NAME, "--bootstrap"],
    sink,
    echo: false,
  }).catch(() => null);
  if (inspect && inspect.exitCode === 0) {
    // An install that predates BUILD_NETWORK has a builder on the default
    // bridge, and this early return is what would keep it there forever: the
    // fix would only ever reach fresh installs, i.e. not the ones actually
    // suffering the DNS failure. Migrate it once instead.
    if (await builderIsOnBuildNetwork(sink)) return BUILDER_NAME;
    sink.system(`moving the ${BUILDER_NAME} builder onto the ${BUILD_NETWORK} network`);
    await runProcess({
      cmd: "docker",
      args: ["buildx", "rm", BUILDER_NAME],
      sink,
      echo: false,
    }).catch(() => null);
    // Falls through to create below. The persistent LAYER cache is on disk
    // under CACHE_ROOT and is untouched by this; only buildkitd's own internal
    // state is lost, once.
  }

  // Not registered for this client yet — create it. If a prior build already
  // created the underlying buildkitd container and it isn't visible here (no
  // persisted BUILDX_CONFIG, e.g. dev), create can conflict; we just fall back
  // to no-cache rather than tear down a possibly-live builder.
  // Put buildkitd on its own network when we can. See BUILD_NETWORK: it fixes
  // container DNS on hosts that resolve through a loopback stub, and stops a
  // tenant RUN step from reaching postgres/redis on the shared compose network.
  const onBuildNetwork = await ensureBuildNetwork(sink);
  if (!onBuildNetwork) {
    sink.system(
      `could not create the ${BUILD_NETWORK} network; the builder will use the default bridge`,
    );
  }

  const create = await runProcess({
    cmd: "docker",
    args: [
      "buildx",
      "create",
      "--name",
      BUILDER_NAME,
      "--driver",
      "docker-container",
      ...(onBuildNetwork ? ["--driver-opt", `network=${BUILD_NETWORK}`] : []),
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
