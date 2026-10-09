/**
 * The isolated build sandbox (od-48w): one ROOTLESS buildkitd container per
 * build host, provisioned by the builder itself through the docker socket.
 *
 * Why self-provisioned rather than a compose service: an in-app update swaps
 * the platform images but never refreshes the install's docker-compose file
 * (the same trap the Caddy edge hit). A compose-only sandbox would exist on
 * fresh installs and be missing on every upgraded one, and since tenant builds
 * fail closed without it, every build on every upgraded install would break.
 * Provisioning from code means fresh installs, in-app upgrades and installer
 * re-runs all converge on the same container, and a sandbox that was removed
 * or stopped heals on the next check.
 *
 * Shape (each argv flag pinned by a unit test):
 *   - image `moby/buildkit:*-rootless`, pinned by digest; buildkitd runs as an
 *     unprivileged uid, so a build-step escape is not host root;
 *   - NEVER `--privileged`, no added capabilities, no host mounts (no docker
 *     socket, no data folder): state lives in a named volume;
 *   - `--oci-worker-no-process-sandbox`: the documented rootless-in-a-container
 *     form (no nested per-step user namespace). rootlesskit itself still needs
 *     ONE user namespace, which Ubuntu 24.04 restricts by default
 *     (`kernel.apparmor_restrict_unprivileged_userns=1`); there the sandbox
 *     runs under the narrow `otterdeploy-buildkitd` AppArmor profile, which
 *     the installer loads and, when an in-app update skipped the installer,
 *     the builder loads itself (see loadSandboxAppArmorProfile). The host-wide
 *     sysctl is never relaxed;
 *   - its own `otterdeploy-build` network, off the shared compose network with
 *     postgres/redis/server (od-5j8.36);
 *   - memory / cpu / pids limits, so a runaway tenant build cannot starve the
 *     host;
 *   - no TCP listener: buildx reaches it with `docker-container://<name>`
 *     (`buildctl dial-stdio` through the docker API, the same transport the old
 *     docker-container driver used), so nothing on any network can dial it and
 *     no socket file permissions have to line up between uids;
 *   - no `--allow-insecure-entitlement`: `RUN --security=insecure` and
 *     `--network=host` stay refused.
 */

import type { BuildSandboxStatus } from "@otterdeploy/api/system-health/build-sandbox";

import { buildSandboxStatusPath } from "@otterdeploy/shared/paths";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { dirname } from "node:path";

import type { LogSink } from "./log-stream";

import {
  BUILD_SANDBOX_APPARMOR_PROFILE,
  ensureSandboxAppArmorProfile,
  hostPrepHint,
  readUsernsRestriction,
  sandboxAppArmorProfile,
} from "./build-sandbox-apparmor";
import { BuildIsolationError } from "./errors";
import { clampCpus } from "./helper-args";
import { dockerQuiet as docker } from "./run-process";

/** Current stable rootless BuildKit (v0.33.1, 2026-09-30), pinned by the
 *  multi-arch index digest so an upstream retag cannot change what runs. */
export const BUILD_SANDBOX_IMAGE =
  "moby/buildkit:v0.33.1-rootless@sha256:f8a833b2de9d68e27f0815e4a737abdfaf8a2e4c615650557df11025101557b4";

export const BUILD_SANDBOX_CONTAINER = "otterdeploy-buildkitd";
export const BUILD_SANDBOX_VOLUME = "otterdeploy-buildkitd-state";
export const BUILD_SANDBOX_NETWORK = "otterdeploy-build";

/** Where buildx dials the sandbox: `buildctl dial-stdio` via `docker exec`. */
export const BUILD_SANDBOX_ENDPOINT = `docker-container://${BUILD_SANDBOX_CONTAINER}`;

/** Label carrying the hash of the run spec, so a builder upgrade that changes
 *  the image or flags recreates the sandbox instead of reusing a stale one. */
const SPEC_LABEL = "otterdeploy.buildkitd.spec";

/** rootless buildkitd keeps its state here (the image's XDG data dir). */
const STATE_DIR = "/home/user/.local/share/buildkit";

/** The legacy SHARED PRIVILEGED buildkitd of the old docker-container builder. */
const LEGACY_CONTAINER = "buildx_buildkit_otterdeploy-cache0";

/** How long a freshly started sandbox gets to answer `buildctl debug workers`. */
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 1_000;

/** Share of host memory the sandbox may use. Builds run inside it, so this is
 *  the memory ceiling for all concurrent tenant builds on the host. */
const MEMORY_SHARE = 0.75;
/** Floor so a tiny host still gets a usable sandbox (docker needs >= 6 MiB). */
const MIN_MEMORY_BYTES = 512 * 1024 * 1024;
const DEFAULT_PIDS_LIMIT = "4096";
/** BuildKit's own GC budget for its layer store (MiB), so the state volume is
 *  bounded instead of growing with every build. */
const GC_KEEP_STORAGE_MB = "10000";

export interface BuildSandboxLimits {
  memoryBytes: number;
  cpus: string;
  pidsLimit: string;
}

/** Limits for this host: 75% of RAM, every CPU (clamped like the helper's),
 *  and a pids cap against fork bombs. PURE given its inputs. */
export function buildSandboxLimits(
  hostMemoryBytes: number,
  hostCpus: number | null,
): BuildSandboxLimits {
  const memoryBytes = Math.max(MIN_MEMORY_BYTES, Math.floor(hostMemoryBytes * MEMORY_SHARE));
  const wanted = hostCpus && hostCpus > 0 ? String(hostCpus) : "1";
  return { memoryBytes, cpus: clampCpus(wanted, hostCpus), pidsLimit: DEFAULT_PIDS_LIMIT };
}

/** The `docker run` flags + buildkitd args, minus the spec label. PURE. */
function sandboxSpec(image: string, limits: BuildSandboxLimits, apparmor: string): string[] {
  return [
    "--restart",
    "unless-stopped",
    "--network",
    BUILD_SANDBOX_NETWORK,
    // Rootless BuildKit sets up its own user namespace; Docker's default
    // seccomp and AppArmor profiles block the unshare/mount calls that needs.
    // These are NOT --privileged: no capabilities are added and the daemon
    // still runs as an unprivileged uid.
    "--security-opt",
    "seccomp=unconfined",
    "--security-opt",
    `apparmor=${apparmor}`,
    "--memory",
    String(limits.memoryBytes),
    "--memory-swap",
    String(limits.memoryBytes),
    "--cpus",
    limits.cpus,
    "--pids-limit",
    limits.pidsLimit,
    "-v",
    `${BUILD_SANDBOX_VOLUME}:${STATE_DIR}`,
    image,
    "--oci-worker-no-process-sandbox",
    "--oci-worker-gc",
    `--oci-worker-gc-keepstorage=${GC_KEEP_STORAGE_MB}`,
  ];
}

/** Stable hash of the spec, carried as a label. PURE. */
export function buildSandboxSpecHash(
  image: string,
  limits: BuildSandboxLimits,
  apparmor: string,
): string {
  return createHash("sha256")
    .update(sandboxSpec(image, limits, apparmor).join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

/** Full `docker run` argv for the sandbox. PURE. */
export function buildSandboxRunArgs(
  image: string,
  limits: BuildSandboxLimits,
  apparmor: string,
): string[] {
  return [
    "run",
    "-d",
    "--name",
    BUILD_SANDBOX_CONTAINER,
    "--label",
    `${SPEC_LABEL}=${buildSandboxSpecHash(image, limits, apparmor)}`,
    "--label",
    "otterdeploy.role=build-sandbox",
    ...sandboxSpec(image, limits, apparmor),
  ];
}

/** What `docker inspect` says about an existing sandbox. */
export interface SandboxState {
  running: boolean;
  spec: string;
}

/** Parse `docker inspect -f '{{.State.Running}} {{index .Config.Labels "…"}}'`. PURE. */
export function parseSandboxState(text: string): SandboxState | null {
  const [running, spec] = text.trim().split(/\s+/);
  if (running !== "true" && running !== "false") return null;
  return { running: running === "true", spec: spec && spec !== "<no" ? spec : "" };
}

/** What to do with the sandbox given its current state. PURE.
 *  `recreateOnDrift` is only true at builder startup and on the periodic
 *  check, never from inside a build: recreating it then would kill every other
 *  build running in it. */
export function planSandbox(
  state: SandboxState | null,
  wantedSpec: string,
  recreateOnDrift: boolean,
): "create" | "recreate" | "start" | "ready" {
  if (state === null) return "create";
  if (recreateOnDrift && state.spec !== wantedSpec) return "recreate";
  return state.running ? "ready" : "start";
}

/** `docker <args>` succeeded? Spawn failures count as no. */
async function dockerOk(sink: LogSink, args: string[]): Promise<boolean> {
  const ran = await docker(sink, args);
  return ran.isOk() && ran.value.exitCode === 0;
}

async function inspectSandbox(sink: LogSink): Promise<SandboxState | null> {
  const ran = await docker(sink, [
    "inspect",
    "-f",
    `{{.State.Running}} {{index .Config.Labels "${SPEC_LABEL}"}}`,
    BUILD_SANDBOX_CONTAINER,
  ]);
  if (ran.isErr() || ran.value.exitCode !== 0) return null;
  return parseSandboxState(ran.value.tail);
}

async function ensureNetwork(sink: LogSink): Promise<boolean> {
  if (await dockerOk(sink, ["network", "inspect", BUILD_SANDBOX_NETWORK])) return true;
  await dockerOk(sink, ["network", "create", BUILD_SANDBOX_NETWORK]);
  // A concurrent caller may have won the create; either way, check again.
  return dockerOk(sink, ["network", "inspect", BUILD_SANDBOX_NETWORK]);
}

async function waitReady(sink: LogSink, timeoutMs: number): Promise<boolean> {
  const deadline = Temporal.Now.instant().add({ milliseconds: timeoutMs });
  while (Temporal.Instant.compare(Temporal.Now.instant(), deadline) < 0) {
    if (await dockerOk(sink, ["exec", BUILD_SANDBOX_CONTAINER, "buildctl", "debug", "workers"])) {
      return true;
    }
    await Bun.sleep(READY_POLL_MS);
  }
  return false;
}

/** The last lines of the sandbox's own log: why it did not come up. */
async function sandboxLogTail(sink: LogSink): Promise<string> {
  const ran = await docker(sink, ["logs", "--tail", "5", BUILD_SANDBOX_CONTAINER]);
  if (ran.isErr()) return "";
  return ran.value.tail.trim().split("\n").slice(-3).join(" | ");
}

/** Is any per-build helper container running? Unknown counts as yes: the cost
 *  of a wrong "busy" is waiting one more check before a spec update. */
export async function buildHelpersRunning(sink: LogSink): Promise<boolean> {
  const ran = await docker(sink, ["ps", "-q", "--filter", "name=^otterbuild-"]);
  if (ran.isErr() || ran.value.exitCode !== 0) return true;
  return ran.value.tail.trim() !== "";
}

/**
 * Remove the old shared PRIVILEGED buildkitd if this host still has it, so no
 * build can ever route through it again. Best-effort.
 */
export async function removeLegacyPrivilegedSandbox(sink: LogSink): Promise<boolean> {
  if (!(await dockerOk(sink, ["inspect", LEGACY_CONTAINER]))) return false;
  sink.system(`removing the legacy shared privileged builder container ${LEGACY_CONTAINER}`);
  return dockerOk(sink, ["rm", "--force", LEGACY_CONTAINER]);
}

/**
 * Carry out `planSandbox`'s verdict: create, recreate or start the sandbox
 * container. "ready" does nothing. Waiting for it to answer is the caller's.
 */
async function applySandboxPlan(
  sink: LogSink,
  plan: ReturnType<typeof planSandbox>,
  {
    image,
    limits,
    apparmor,
    loaderNote,
  }: { image: string; limits: BuildSandboxLimits; apparmor: string; loaderNote: string },
): Promise<Result<void, BuildIsolationError>> {
  if (plan === "start") {
    await dockerOk(sink, ["start", BUILD_SANDBOX_CONTAINER]);
    return Result.ok();
  }
  if (plan === "ready") return Result.ok();
  if (plan === "recreate") {
    sink.system(`updating the build sandbox ${BUILD_SANDBOX_CONTAINER} to the current spec`);
    await dockerOk(sink, ["rm", "--force", BUILD_SANDBOX_CONTAINER]);
  }
  sink.system(`starting the rootless build sandbox ${BUILD_SANDBOX_CONTAINER}`);
  const ran = await docker(sink, buildSandboxRunArgs(image, limits, apparmor));
  if (ran.isOk() && ran.value.exitCode === 0) return Result.ok();
  // A concurrent build may have created it first (name conflict): fine as
  // long as one is now running. A run docker refused at start (e.g. the
  // AppArmor profile is not loaded) still leaves a created-but-stopped
  // container behind: remove it so the next check retries cleanly, and
  // report docker's own error rather than a readiness timeout.
  const after = await inspectSandbox(sink);
  if (after?.running) return Result.ok();
  if (after) await dockerOk(sink, ["rm", "--force", BUILD_SANDBOX_CONTAINER]);
  const detail = ran.isOk() ? ran.value.tail.trim().split("\n").slice(-2).join(" | ") : ran.error;
  const reason = `could not start ${BUILD_SANDBOX_CONTAINER} from ${image}: ${detail}${loaderNote}${hostPrepHint(apparmor, detail)}`;
  return Result.err(new BuildIsolationError(reason));
}

/**
 * Make sure the rootless sandbox exists, runs, and answers. Idempotent.
 * Returns the buildx endpoint to dial, or the reason it could not be readied.
 */
export async function ensureBuildSandbox(
  sink: LogSink,
  opts: {
    recreateOnDrift: boolean;
    image?: string;
    /** How long a started sandbox gets to answer; tests shorten it. */
    readyTimeoutMs?: number;
    /** The userns-restriction sysctl's text; read from /proc when omitted.
     *  Tests pass it so the AppArmor choice does not depend on the test host. */
    usernsRestriction?: string | null;
    /** Image for the AppArmor loader container (the builder's own). Given by
     *  the builder's boot + periodic check, which then load the sandbox's
     *  profile on a host that needs it before starting the sandbox. */
    appArmorLoaderImage?: string;
    /** Where the profile text is read from; tests point it elsewhere. */
    installerPath?: URL | string;
  },
): Promise<Result<string, BuildIsolationError>> {
  const readyTimeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const image = opts.image || BUILD_SANDBOX_IMAGE;
  const limits = buildSandboxLimits(totalmem(), cpus().length || null);
  const apparmor = sandboxAppArmorProfile(
    opts.usernsRestriction === undefined ? await readUsernsRestriction() : opts.usernsRestriction,
  );
  const wanted = buildSandboxSpecHash(image, limits, apparmor);
  const fail = (reason: string) => Result.err(new BuildIsolationError(reason));

  if (!(await ensureNetwork(sink))) {
    return fail(`could not create the ${BUILD_SANDBOX_NETWORK} docker network`);
  }

  const plan = planSandbox(await inspectSandbox(sink), wanted, opts.recreateOnDrift);
  // About to (re)start the sandbox under the narrow profile: make sure the
  // host has it loaded. A load that fails is not fatal by itself (install.sh
  // may have loaded it already); if the sandbox then cannot start, the
  // refusal carries the loader's reason too.
  const loaderNote =
    opts.appArmorLoaderImage && apparmor === BUILD_SANDBOX_APPARMOR_PROFILE && plan !== "ready"
      ? await ensureSandboxAppArmorProfile(sink, opts.appArmorLoaderImage, opts.installerPath)
      : "";
  const applied = await applySandboxPlan(sink, plan, { image, limits, apparmor, loaderNote });
  if (applied.isErr()) return Result.err(applied.error);

  if (!(await waitReady(sink, readyTimeoutMs))) {
    const why = await sandboxLogTail(sink);
    return fail(
      `${BUILD_SANDBOX_CONTAINER} did not become ready within ${readyTimeoutMs / 1000}s${why ? `: ${why}` : ""}${loaderNote}${hostPrepHint(apparmor, why)}`,
    );
  }
  return Result.ok(BUILD_SANDBOX_ENDPOINT);
}

/** Record the sandbox status where the server's health card reads it.
 *  Best-effort: a status file that cannot be written must not stop builds. */
export async function writeBuildSandboxStatus(
  status: Omit<BuildSandboxStatus, "checkedAt">,
): Promise<void> {
  const path = buildSandboxStatusPath();
  const body: BuildSandboxStatus = { ...status, checkedAt: Temporal.Now.instant().toString() };
  await Result.tryPromise(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(body, null, 2)}\n`);
  });
}
