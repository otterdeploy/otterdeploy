/**
 * Which variables a Railpack build sees, and how they get there.
 *
 * Two sources:
 *   - the BUILDER's own knobs: the NODE_OPTIONS memory guard, the SPA output
 *     dir, turbo cache credentials / TURBO_FORCE / TURBO_CACHE_DIR
 *   - the SERVICE's resolved env (build-env.ts): `NEXT_PUBLIC_*`, `VITE_*`,
 *     `RAILPACK_*` overrides, anything the app's build reads
 *
 * Every key is declared and mounted by NAME, so no value lands in argv (which
 * the build log echoes and `ps` shows), the on-disk plan, or an image layer:
 *   1. `railpack prepare --env NAME`. Railpack reads the value from its process
 *      env (`FromEnvs`: no `=` means `os.LookupEnv`), uses it while planning
 *      (`RAILPACK_*`, `CGO_ENABLED`, …), and records only NAME in the plan's
 *      `secrets`.
 *   2. `docker buildx build --secret id=NAME,…`. BuildKit mounts the value into
 *      the build steps as env; secret mounts never enter a layer or the image
 *      history (unlike `--build-arg`, see BuildDockerfileConfig). Builder keys
 *      use `env=NAME`. Service keys use `src=<file>` (railpack-secret-files.ts)
 *      so that a service variable never enters the docker CLI's OWN env: the
 *      helper's docker client holds the host socket, and a `DOCKER_CONFIG` or
 *      `DOCKER_HOST` set as a service variable must not steer it.
 *
 * BuildKit does not key the layer cache on secret VALUES, so a changed
 * `NEXT_PUBLIC_API_URL` would otherwise reuse the stale `next build` layer.
 * Railpack's documented remedy is the `secrets-hash` build arg: a digest of the
 * values, mounted into each step that reads secrets.
 *
 * PURE: no I/O, so the whole merge is testable without railpack or docker.
 */

import { createHash } from "node:crypto";

/** The service's variables for one build, resolved by build-env.ts. */
export interface ServiceBuildEnv {
  /** Every resolved service variable, by name. */
  env: Record<string, string>;
  /** Values that came from a sealed or secret row (or a reference to one).
   *  Masked wherever the build log could echo them. */
  secretValues: string[];
}

/** A service with no variables: the build sees only the builder's own knobs. */
export const NO_SERVICE_BUILD_ENV: ServiceBuildEnv = { env: {}, secretValues: [] };

/** Turbo remote-cache credentials. Opt-in per service (`turboRemoteCache`), so a
 *  TURBO_TOKEN sitting in the service env must not switch the remote cache on
 *  behind that setting's back; turbo-cache.ts forwards them when it is on. */
const TURBO_CREDENTIAL_KEYS = new Set(["TURBO_TOKEN", "TURBO_TEAM", "TURBO_API"]);

/** Names that change how `railpack prepare` itself (and the mise it spawns
 *  with this PATH) runs on the builder: the binary search path, the dynamic
 *  loader, home/temp dirs. The build container sets its own, so a service
 *  value here buys nothing and could run code inside the helper. */
const BUILDER_PROCESS_KEYS = new Set(["PATH", "HOME", "TMPDIR"]);
const BUILDER_PROCESS_PREFIXES = ["LD_", "DYLD_"];

/** A name both ends accept whole: a BuildKit secret id inside `id=K,…` (no `,`
 *  or `=`), and railpack's `--env` parser (`[A-Za-z0-9_+-]*`). */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RailpackBuildEnv {
  /** Builder-owned values: in both child process envs, mounted with `env=`. */
  builderEnv: Record<string, string>;
  /** Service-owned values: in `prepare`'s env only, mounted from files. */
  serviceEnv: Record<string, string>;
  /** `secrets-hash` build arg over the service's values, null when the service
   *  contributes none (the build is then byte-identical to before). */
  secretsHash: string | null;
  /** Service keys that do not reach the build, with the reason, for the log. */
  dropped: Array<{ key: string; reason: string }>;
}

/**
 * Split the service's env from the builder's. Builder keys win: the memory
 * guard protects the build host, and the SPA dir / turbo knobs must match what
 * the rest of the pipeline was told. A service key the builder overrides with a
 * DIFFERENT value is reported, so the override is never silent.
 */
export function railpackBuildEnv(opts: {
  serviceEnv: Record<string, string>;
  builderEnv: Record<string, string>;
}): RailpackBuildEnv {
  const serviceEnv: Record<string, string> = {};
  const dropped: RailpackBuildEnv["dropped"] = [];
  const drop = (key: string, reason: string) => void dropped.push({ key, reason });

  for (const [key, value] of Object.entries(opts.serviceEnv)) {
    if (!ENV_NAME.test(key)) drop(key, "it is not a valid environment variable name");
    else if (key in opts.builderEnv) {
      if (opts.builderEnv[key] !== value) drop(key, "the builder sets it for this build");
    } else if (isBuilderProcessKey(key)) drop(key, "it would change how the builder itself runs");
    else if (TURBO_CREDENTIAL_KEYS.has(key)) {
      drop(key, "the Turbo remote cache is off for this service");
    } else serviceEnv[key] = value;
  }

  return {
    builderEnv: opts.builderEnv,
    serviceEnv,
    secretsHash: secretsHash(serviceEnv),
    dropped,
  };
}

function isBuilderProcessKey(key: string): boolean {
  return BUILDER_PROCESS_KEYS.has(key) || BUILDER_PROCESS_PREFIXES.some((p) => key.startsWith(p));
}

/** sha256 over the sorted `KEY=VALUE` pairs; null for an empty bag. Keys are
 *  included so moving a value between two keys still invalidates. */
function secretsHash(env: Record<string, string>): string | null {
  const keys = Object.keys(env).sort();
  if (keys.length === 0) return null;
  const hash = createHash("sha256");
  for (const key of keys) hash.update(`${key}=${env[key] ?? ""}\0`);
  return hash.digest("hex");
}
