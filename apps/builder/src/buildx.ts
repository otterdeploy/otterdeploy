/**
 * Tenant build isolation (od-48w) + the persistent BuildKit layer cache.
 *
 * Every tenant Dockerfile/Railpack `RUN` step runs inside buildkitd. The old
 * design pointed buildx at a shared `--driver docker-container` builder, which
 * boots its buildkitd companion `--privileged`, so one tenant `RUN` that
 * escaped runc got host root and every other tenant's build. That is the P0
 * this module closes.
 *
 * Now every build goes through buildx's `remote` driver to the ROOTLESS
 * sandbox the builder provisions itself (build-sandbox.ts): unprivileged, on
 * its own network, reached through `docker-container://` so it has no
 * listener at all. The insecure entitlement (`security.insecure`, which
 * `RUN --security=insecure` needs) is NEVER granted.
 *
 * `ensureBuildxBuilder` FAILS CLOSED: if the sandbox cannot be readied it
 * returns an error rather than building on the host daemon. The only
 * unisolated path is the explicit single-operator opt-out
 * (`BUILDER_ALLOW_UNISOLATED=true`), used by local dev.
 *
 * Cache: exported/imported `--cache-to/from type=local` under the data folder,
 * NAMESPACED by org + project so no two tenants ever share a mutable cache dir
 * (the old shared, repo-keyed dir let two orgs' images with one name collide
 * and feed layers into each other). Within one project the cache stays warm.
 */

import { buildxCacheDir } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { join } from "node:path";

import type { LogSink } from "./log-stream";

import { ensureBuildSandbox, removeLegacyPrivilegedSandbox } from "./build-sandbox";
import { BuildIsolationError } from "./errors";
import { runProcess } from "./run-process";

/** Name of the isolated rootless remote-driver builder. */
const REMOTE_BUILDER_NAME = "otterdeploy-rootless";

/** The legacy SHARED PRIVILEGED `docker-container` builder registration. */
const LEGACY_BUILDER_NAME = "otterdeploy-cache";

/** Root for exported BuildKit caches: one subtree per org/project/repo. */
const CACHE_ROOT = buildxCacheDir();

/**
 * `buildx create` argv for the isolated rootless remote builder. PURE.
 *
 * INVARIANTS (each pinned by a unit test: this is the od-48w fix):
 *   - the driver is ALWAYS `remote`, NEVER `docker-container` (the privileged
 *     path) and never the default docker driver;
 *   - the rootless sandbox endpoint is the only thing it points at;
 *   - no `--allow-insecure-entitlement` / `security.insecure` is ever emitted,
 *     so `RUN --security=insecure` has no entitlement to use and fails.
 */
export function buildxCreateArgs(endpoint: string): string[] {
  return [
    "buildx",
    "create",
    "--name",
    REMOTE_BUILDER_NAME,
    "--driver",
    "remote",
    "--bootstrap",
    endpoint,
  ];
}

/** The endpoint an existing builder registration points at, from
 *  `docker buildx inspect` output, or null. PURE. */
export function parseBuilderEndpoint(inspect: string): string | null {
  const match = inspect.match(/^\s*Endpoint:\s*(\S+)/m);
  return match?.[1] ?? null;
}

async function inspectBuilder(sink: LogSink, name: string): Promise<string | null> {
  const ran = await Result.tryPromise(() =>
    runProcess({ cmd: "docker", args: ["buildx", "inspect", name], sink, echo: false }),
  );
  if (ran.isErr() || ran.value.exitCode !== 0) return null;
  return ran.value.tail;
}

async function buildx(sink: LogSink, args: string[]): Promise<boolean> {
  const ran = await Result.tryPromise(() => runProcess({ cmd: "docker", args, sink, echo: false }));
  return ran.isOk() && ran.value.exitCode === 0;
}

/**
 * Remove the legacy shared PRIVILEGED `docker-container` builder (its buildx
 * registration and its buildkitd container) if this install still has it, so
 * no build ever routes through the privileged path again. Best-effort; the
 * on-disk layer cache under CACHE_ROOT is untouched.
 */
async function removeLegacyPrivilegedBuilder(sink: LogSink): Promise<void> {
  if ((await inspectBuilder(sink, LEGACY_BUILDER_NAME)) !== null) {
    sink.system(
      `removing the legacy shared privileged '${LEGACY_BUILDER_NAME}' builder: builds now run in the rootless sandbox`,
    );
    await buildx(sink, ["buildx", "rm", "--force", LEGACY_BUILDER_NAME]);
  }
  await removeLegacyPrivilegedSandbox(sink);
}

/**
 * Ready the isolated build backend and return the builder name to pass as
 * `--builder`, or `null` for the opt-out default-driver path.
 *
 * FAILS CLOSED (od-48w): unless the operator explicitly opted out, the build
 * MUST go through the rootless sandbox; if it cannot be readied this returns
 * the reason instead of degrading to the host daemon.
 */
export async function ensureBuildxBuilder(
  sink: LogSink,
  /** Read from `@otterdeploy/env/server` by the caller and passed in so this
   *  module (and its unit tests) never import the env schema, which throws at
   *  import time without the full platform secret set. */
  opts: { buildkitHost: string; allowUnisolated: boolean },
): Promise<Result<string | null, BuildIsolationError>> {
  await removeLegacyPrivilegedBuilder(sink);

  if (opts.allowUnisolated && opts.buildkitHost.trim() === "") {
    sink.system(
      "BUILDER_ALLOW_UNISOLATED=true: building on the host daemon without tenant isolation (trusted local use only)",
    );
    return Result.ok(null);
  }

  // An operator-supplied BuildKit endpoint wins; otherwise the self-provisioned
  // sandbox. Never recreate it from inside a build (that would kill the other
  // builds running in it); the builder's own checks handle spec drift.
  let endpoint = opts.buildkitHost.trim();
  if (endpoint === "") {
    const sandbox = await ensureBuildSandbox(sink, { recreateOnDrift: false });
    if (sandbox.isErr()) return Result.err(sandbox.error);
    endpoint = sandbox.value;
  }

  // Registered already (BUILDX_CONFIG persists it across helper containers)
  // and pointing at the right place: fast path.
  const existing = await inspectBuilder(sink, REMOTE_BUILDER_NAME);
  if (existing !== null && parseBuilderEndpoint(existing) === endpoint) {
    return Result.ok(REMOTE_BUILDER_NAME);
  }
  if (existing !== null) {
    await buildx(sink, ["buildx", "rm", "--force", REMOTE_BUILDER_NAME]);
  }
  if (await buildx(sink, buildxCreateArgs(endpoint))) return Result.ok(REMOTE_BUILDER_NAME);
  // A concurrent build may have registered it between the inspect and create.
  const raced = await inspectBuilder(sink, REMOTE_BUILDER_NAME);
  if (raced !== null && parseBuilderEndpoint(raced) === endpoint) {
    return Result.ok(REMOTE_BUILDER_NAME);
  }
  return Result.err(
    new BuildIsolationError(
      `could not register the '${REMOTE_BUILDER_NAME}' builder at ${endpoint}`,
    ),
  );
}

/** One component of a cache namespace, made path-safe (collapse `/`, `:`, etc.
 *  so each distinct value maps to exactly one dir). PURE. */
function cacheSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

/** The tenant + image a build's cache belongs to. */
export interface CacheScope {
  organizationId: string;
  projectId: string;
  imageRepository: string;
}

/**
 * Local cache dir for one build, e.g.
 * `<DATA_ROOT>/cache/buildx/<org>/<project>/ghcr.io_acme_web`.
 *
 * NAMESPACED by org + project (od-48w): the old shared, repo-keyed dir let two
 * orgs' registry-less `otterdeploy-local/web` images (serviceName is not
 * org-scoped) collide on one mutable dir, so one tenant could read or poison
 * another's cached layers. Scoping by org+project makes that impossible while
 * keeping a given project's cache warm across builds. PURE.
 */
export function cachePathFor(scope: CacheScope): string {
  return join(
    CACHE_ROOT,
    cacheSegment(scope.organizationId),
    cacheSegment(scope.projectId),
    cacheSegment(scope.imageRepository),
  );
}

/** `--builder <name>` when a cache builder is in use, else nothing. PURE. */
export function builderFlags(builderName: string | null | undefined): string[] {
  return builderName ? ["--builder", builderName] : [];
}

/**
 * `--cache-from`/`--cache-to type=local` flags — emitted ONLY when both a
 * remote builder and a (tenant-scoped) cache path are present (the default
 * driver rejects cache export, so we must not emit these without the builder).
 * PURE.
 *
 * `noCache` is the per-deploy bypass ("Redeploy without cache"): it drops
 * `--cache-from` so nothing stale is READ, but keeps `--cache-to` so the run
 * repopulates the cache for the next build.
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
 * Turbo credentials for one build: values to expose to the build process. They
 * join the build env (railpack-env.ts), which declares and mounts every key as
 * a buildx secret.
 *
 * The SHAPE lives here, next to the other cache flags, rather than in
 * turbo-cache.ts. That module resolves the service's encrypted variables and
 * therefore imports the db, and railpack.ts must not drag a database
 * connection into its module graph just to name a type.
 */
export interface TurboCacheEnv {
  /** Keys → values to expose to the build process, empty when disabled. */
  env: Record<string, string>;
}

/** No turbo credentials: the shape every disabled/failed lookup returns. */
export const NO_TURBO_CACHE: TurboCacheEnv = { env: {} };

/**
 * `TURBO_FORCE=1` when the deploy asked to bypass caches. PURE.
 */
export function turboForceEnv(noCache: boolean | null | undefined): Record<string, string> {
  return noCache ? { TURBO_FORCE: "1" } : {};
}
