/**
 * Pure `docker run` argv composition for the per-build helper container
 * (see `handler.ts`, which owns spawning/waiting on it). Split into its own
 * module — with NO dependency on `@otterdeploy/env/server` or any other
 * env-schema-validated import — so this composition is unit-testable
 * without a real DATABASE_URL/BETTER_AUTH_SECRET/etc. present: importing
 * `@otterdeploy/env/server` throws at import time if the full env schema
 * isn't satisfied, which would make every test importing this logic depend
 * on real secrets.
 */

import type { DeploymentId } from "@otterdeploy/shared/id";

/**
 * Env keys forwarded by name into the helper container (`docker run -e KEY`
 * passes the worker's current value). Only those actually set are forwarded —
 * the rest fall back to the env schema's defaults inside the helper.
 * OTTERDEPLOY_DATA_DIR rides along so the helper resolves the SAME DATA_ROOT as
 * the host — the buildx cache path + bind mount below must agree.
 *
 * Deliberately NOT forwarded, even though the worker itself has them:
 * `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PUBLIC_WEB_URL` — all optional (or
 * defaulted) in `@otterdeploy/env`'s schema and unused by anything on the
 * build/redeploy path (verified: no email send, no web-URL read reachable
 * from `pipeline.ts` or `redeployOne`). A compromised helper can't exfiltrate
 * an API key it was never handed.
 *
 * Still forwarded despite being sensitive, because `@otterdeploy/env/server`
 * requires them unconditionally (no `.optional()`/`.default()`) and the
 * helper crashes on import without them: `BETTER_AUTH_SECRET` (the
 * platform's master signing/encryption secret — every secret at rest is
 * derived from it) and `BETTER_AUTH_URL`/`CORS_ORIGIN` (required by the same
 * shared schema for unrelated auth/CORS features the build path never
 * touches). This is real, unresolved exposure — see od-5j8.15 notes; closing
 * it needs the shared env schema to stop treating "the whole platform's
 * secret" as a hard requirement for a build helper that never uses it, which
 * is a larger change than this pass makes.
 */
export const FORWARDED_ENV = [
  "DATABASE_URL",
  "DATABASE_PROVISIONER_URL",
  "REDIS_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "CORS_ORIGIN",
  "NODE_ENV",
  "OTTERDEPLOY_DATA_DIR",
] as const;

/** A DATABASE_URL/REDIS_URL of `localhost` in the worker's env points at the
 *  HELPER container itself, not the host datastore. When the worker IS the
 *  compose service these already use service DNS (`postgres`/`redis`), so
 *  nothing matches and the raw value forwards unchanged. But when the worker
 *  runs on the HOST for local dev (`bun dev`), rewrite the loopback host to
 *  `host.docker.internal` (resolvable via `--add-host`, see
 *  `buildHelperRunArgs`) so the helper reaches the host's Postgres/Redis. */
const CONNECTION_KEYS = new Set(["DATABASE_URL", "DATABASE_PROVISIONER_URL", "REDIS_URL"]);

function toHostGateway(v: string): string {
  return v.replace(/([@/])(localhost|127\.0\.0\.1)(?=[:/])/g, "$1host.docker.internal");
}

/** Build the `-e KEY[=value]` flags forwarding `FORWARDED_ENV` from
 *  `sourceEnv` (only keys actually set are forwarded — the rest fall back to
 *  the env schema's defaults inside the helper). */
export function buildHelperEnvFlags(sourceEnv: Record<string, string | undefined>): string[] {
  return FORWARDED_ENV.flatMap((key) => {
    const value = sourceEnv[key];
    if (value === undefined) return [];
    if (CONNECTION_KEYS.has(key) && /(localhost|127\.0\.0\.1)/.test(value)) {
      return ["-e", `${key}=${toHostGateway(value)}`];
    }
    return ["-e", key];
  });
}

/**
 * Container-level hardening for the per-build helper. Doesn't touch the
 * dominant escape vector (see od-5j8.15 notes: the shared `buildx`
 * `docker-container` builder runs its `buildkitd` companion `--privileged`,
 * confirmed via `docker inspect` — that's where a tenant Dockerfile's `RUN`
 * steps actually execute, in a container this helper doesn't control the
 * flags of), but does shrink what a compromise of the helper's OWN process
 * (the long-lived `bun`/`railpack`/`docker` CLI code — a supply-chain bug in
 * a builder dependency, not tenant Dockerfile content) can do with the
 * `docker.sock` and DB/Redis credentials it necessarily holds:
 *   - `no-new-privileges` + `--cap-drop ALL`: the helper's own process needs
 *     no Linux capabilities beyond what an unprivileged `bun` process has by
 *     default — it only ever *talks to* the daemon over the socket.
 *   - `--pids-limit`/`--memory`/`--memory-swap`/`--cpus`: bound a runaway or
 *     forkbombing build to this container instead of starving the host.
 * Not applied: `--read-only`. `docker login`/`buildx`'s own state both write
 * outside the bind-mounted cache dir (e.g. `~/.docker/config.json`), and
 * making the rootfs read-only without first relocating every one of those
 * writes risks silently breaking registry pushes — left as follow-up rather
 * than shipped unverified.
 */
export interface HelperHardeningConfig {
  pidsLimit: string;
  memory: string;
  cpus: string;
}

export const HELPER_HARDENING_DEFAULTS: HelperHardeningConfig = {
  pidsLimit: "512",
  memory: "4g",
  cpus: "2",
};

/**
 * Hold `--cpus` to what the host actually has.
 *
 * Docker REJECTS a request above the host's CPU count outright — it does not
 * clamp or warn:
 *
 *   docker: Error response from daemon: range of CPUs is from 0.01 to 1.00,
 *   as there are only 1 CPUs available
 *
 * and the helper exits 125 before the build starts, surfacing as "Deployment
 * failed during build process" with nothing in the log to explain it. The
 * default of 2 therefore made every build fail on a single-vCPU box — the
 * cheapest Hetzner/DO/Vultr tier, and a very common self-hosted target.
 *
 * Clamping rather than lowering the default: a 2-CPU floor is the right ask on
 * hosts that have the cores, and the limit exists to stop a runaway build
 * starving the host — a value the host cannot satisfy protects nothing.
 *
 * An explicit `BUILDER_HELPER_CPUS` is clamped too. It is a tuning knob, and
 * being told "your override was reduced to what exists" is better than a build
 * that cannot start.
 */
export function clampCpus(requested: string, hostCpus: number | null): string {
  const wanted = Number.parseFloat(requested);
  // Unparseable or nonsensical: hand it to docker unchanged rather than
  // inventing a value — docker's own error names the problem better than a
  // silent substitution would.
  if (!Number.isFinite(wanted) || wanted <= 0) return requested;
  if (hostCpus === null || !Number.isFinite(hostCpus) || hostCpus <= 0) return requested;
  if (wanted <= hostCpus) return requested;
  // Docker's floor is 0.01; a host reporting fractional cores still needs a
  // value it will accept.
  return String(Math.max(0.01, Math.floor(hostCpus * 100) / 100));
}

export function helperHardeningFlags(
  overrides: Partial<HelperHardeningConfig> = {},
  /** Logical CPUs on the DOCKER HOST. Null skips clamping (caller couldn't
   *  determine it), which preserves the previous behaviour rather than
   *  guessing a limit. */
  hostCpus: number | null = null,
): string[] {
  const merged = { ...HELPER_HARDENING_DEFAULTS, ...overrides };
  const cfg = { ...merged, cpus: clampCpus(merged.cpus, hostCpus) };
  return [
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--pids-limit",
    cfg.pidsLimit,
    "--memory",
    cfg.memory,
    // Same as --memory: no swap headroom beyond the hard memory cap above,
    // so an OOMing build gets killed (137, already handled by
    // classifyHelperExit in handler.ts) instead of thrashing host swap.
    "--memory-swap",
    cfg.memory,
    "--cpus",
    cfg.cpus,
  ];
}

/** Reads the three hardening knobs from `sourceEnv`, falling back to
 *  `HELPER_HARDENING_DEFAULTS`. Plain env keys (not the shared `env` schema
 *  in `@otterdeploy/env`) so tuning these never requires touching that
 *  schema. */
export function helperHardeningFromEnv(
  sourceEnv: Record<string, string | undefined>,
): Partial<HelperHardeningConfig> {
  const overrides: Partial<HelperHardeningConfig> = {};
  if (sourceEnv.BUILDER_HELPER_PIDS_LIMIT) {
    overrides.pidsLimit = sourceEnv.BUILDER_HELPER_PIDS_LIMIT;
  }
  if (sourceEnv.BUILDER_HELPER_MEMORY) {
    overrides.memory = sourceEnv.BUILDER_HELPER_MEMORY;
  }
  if (sourceEnv.BUILDER_HELPER_CPUS) {
    overrides.cpus = sourceEnv.BUILDER_HELPER_CPUS;
  }
  return overrides;
}

/**
 * Compose the full `docker run` argv for one build helper. Pure (no I/O, no
 * `process.env` reads) so the exact flag set — in particular the hardening
 * flags from `helperHardeningFlags` and that the raw socket mount is still
 * present — is directly assertable in a unit test instead of only
 * observable by running a real container.
 */
export function buildHelperRunArgs(opts: {
  deploymentId: DeploymentId;
  network: string;
  image: string;
  envFlags: string[];
  sourceFlags: string[];
  cacheFlags: string[];
  hardeningFlags: string[];
}): string[] {
  return [
    "run",
    "--rm",
    "--name",
    `otterbuild-${opts.deploymentId}`,
    "--network",
    opts.network,
    ...opts.hardeningFlags,
    // Make `host.docker.internal` resolve to the host gateway inside the helper
    // (Docker Desktop provides it automatically; Linux needs this explicit
    // mapping). Harmless when unused — it only matters for the localhost→host
    // rewrite above when the worker runs on the host for local dev.
    "--add-host",
    "host.docker.internal:host-gateway",
    // Docker-out-of-Docker: the build's `buildx --load` and swarm calls speak
    // to the host daemon through this socket — same one the worker uses. See
    // od-5j8.15 notes: this raw socket mount is the one hardening flag CANNOT
    // narrow — closing it needs either a filtering proxy in front of the
    // socket or moving off docker-out-of-docker entirely, neither landed yet.
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    ...opts.cacheFlags,
    ...opts.sourceFlags,
    ...opts.envFlags,
    opts.image,
    "bun",
    "run",
    "src/build-one.ts",
    opts.deploymentId,
  ];
}
