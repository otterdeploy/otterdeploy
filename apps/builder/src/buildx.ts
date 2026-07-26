/**
 * BuildKit builder resolution for tenant Dockerfile/Railpack builds.
 *
 * SECURITY (closes od-48w — the dominant host-escape vector): builds used to
 * run inside a shared, buildx-MANAGED `docker-container` driver builder.
 * `docker inspect` on that builder's `buildkitd` companion showed
 * `"Privileged": true` — buildx's `docker-container` driver hardcodes
 * `--privileged` on the container IT creates, REGARDLESS of the image it
 * boots (`--driver-opt image=moby/buildkit:buildx-stable-1-rootless` does not
 * change this: the rootless image only changes what USER runs inside that
 * still-privileged container). So every tenant's Dockerfile `RUN` step
 * effectively ran as host root, and — because the builder was one shared,
 * long-lived instance — any tenant's build could reach every other tenant's
 * build (and the host).
 *
 * The fix here is to stop letting buildx create/manage the builder container
 * at all. A standalone, rootless `buildkitd` runs as its OWN long-lived
 * service (the `buildkitd` compose service in docker-compose.yml /
 * docker-compose.prod.yml) — no `--privileged`, no added Linux capabilities.
 * Verified locally via `docker inspect buildkitd --format '{{.HostConfig.
 * Privileged}}'` → `false`. Every build reaches it through buildx's `remote`
 * driver, which does nothing but open a gRPC connection to an address — it
 * never spawns or manages a container, so there's no privileged bootstrap
 * step to intercept, override, or fall back into.
 *
 * The remote buildkitd's build/cache execution is intentionally shared and
 * content-addressed across tenants (that's the entire point of a persistent
 * builder — warm layer caches survive across builds with zero extra
 * plumbing, replacing the old per-repo local-dir `--cache-from/--cache-to`
 * mechanism entirely: BuildKit already does this internally once the builder
 * is long-lived, complete with its own size/age-based GC policy instead of
 * the unbounded local cache dir this replaces). What's NOT shared: each
 * build's `RUN` steps execute in their own unprivileged, single-use OCI
 * container sandbox inside buildkitd — one tenant's build cannot see another
 * tenant's build context, environment, or process tree.
 *
 * Everything here is BEST-EFFORT: if no buildkitd address is configured, or
 * it can't be reached, `ensureBuildxBuilder` returns null and the caller
 * builds the original way — the default docker driver, `--load`, no shared
 * cache. That fallback NEVER creates a `docker-container` builder (which
 * would silently reintroduce the privileged-container vector this module
 * exists to close) — it is the host daemon's own built-in BuildKit, same
 * trust boundary as any plain `docker build`. A build NEVER fails because the
 * remote builder is unavailable.
 */

import type { LogSink } from "./log-stream";

import { runProcess } from "./run-process";

/** Stable name for the remote-driver builder pointed at the standalone
 *  buildkitd. Re-registering under this name is idempotent (buildx just
 *  reuses the existing entry), so repeated calls across helper containers
 *  converge on the same builder without any shared local state. */
const BUILDER_NAME = "otterdeploy-remote";

/** `docker buildx inspect <name> --bootstrap` argv. PURE — exists so the
 *  exact command is directly assertable without invoking docker. */
export function buildxInspectArgs(builderName: string): string[] {
  return ["buildx", "inspect", builderName, "--bootstrap"];
}

/**
 * `docker buildx create --driver remote <addr>` argv. PURE. Deliberately
 * NEVER `--driver docker-container` and NEVER `--privileged` — this is the
 * one function that decides how the builder gets created, so a regression
 * back to the privileged path would show up here first (see
 * `__tests__/buildx.test.ts`).
 */
export function buildxCreateArgs(builderName: string, addr: string): string[] {
  return ["buildx", "create", "--name", builderName, "--driver", "remote", addr];
}

/** Reads the standalone buildkitd's address (e.g. `tcp://buildkitd:1234`)
 *  from the environment. A plain env read (not the shared `@otterdeploy/env`
 *  schema) — same rationale as `helper-args.ts`: this module must stay
 *  importable (and unit-testable) without a full validated env. Unset ⇒ no
 *  remote builder is attempted at all (dev / a host with no buildkitd
 *  service running), so nothing here ever blocks on a connection nobody
 *  configured. */
export function readBuildkitAddr(
  // eslint-disable-next-line node/no-process-env
  sourceEnv: Record<string, string | undefined> = process.env,
): string | undefined {
  return sourceEnv.BUILDKIT_ADDR || undefined;
}

/**
 * Ensure a buildx builder pointed at the standalone remote buildkitd exists
 * and is reachable. Returns its name (pass as `--builder`), or null when no
 * address is configured or it can't be reached — the caller then builds via
 * the default driver with no `--builder` flag at all. Never throws.
 */
export async function ensureBuildxBuilder(sink: LogSink, addr?: string): Promise<string | null> {
  const buildkitAddr = addr ?? readBuildkitAddr();
  if (!buildkitAddr) return null;

  // Already registered (buildx's own local state persists it across helper
  // containers via the CLI's config dir) — `--bootstrap` confirms it's live.
  const inspect = await runProcess({
    cmd: "docker",
    args: buildxInspectArgs(BUILDER_NAME),
    sink,
    echo: false,
  }).catch(() => null);
  if (inspect && inspect.exitCode === 0) return BUILDER_NAME;

  // Not registered for this client yet — create it. The `remote` driver only
  // records the endpoint; it does not start, own, or need to reach a docker
  // daemon to do so (confirmed locally with `DOCKER_HOST` pointed at a
  // nonexistent socket during `create` + a real `buildx build --push`).
  const create = await runProcess({
    cmd: "docker",
    args: buildxCreateArgs(BUILDER_NAME, buildkitAddr),
    sink,
    echo: false,
  }).catch(() => null);
  if (create && create.exitCode === 0) return BUILDER_NAME;

  sink.system("remote buildkitd unavailable — building without it (no shared layer cache)");
  return null;
}

/** `--builder <name>` when a remote builder is in use, else nothing. PURE. */
export function builderFlags(builderName: string | null | undefined): string[] {
  return builderName ? ["--builder", builderName] : [];
}
