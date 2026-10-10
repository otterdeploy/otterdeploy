/**
 * Apply orchestrator. The self-replacement crux.
 *
 * A compose stack can't `up` itself and survive: recreating the `server`
 * container kills the process mid-command. So the real path is to launch a
 * DETACHED, auto-removing HELPER container (docker CLI + compose,
 * socket + install-dir mounted) that bumps the pinned version and runs
 * `compose pull && up -d`. The server hands off, ends the progress stream, and
 * the browser polls /health for the new container.
 *
 * The dry-run path replaces the helper with an in-process simulation that emits
 * the same progress phases and flips nothing, so the entire flow is exercisable
 * locally with no real newer image and no restart. Chosen by resolveDryRun()
 * (dev-default ON), so `bun dev` is safe out of the box.
 */
import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { Temporal } from "@otterdeploy/shared/temporal";
import { log } from "evlog";

import { createRequestDockerClient } from "../../lib/docker-client";
import { pullImage } from "../../runtime/docker-driver-helpers";
import { ensureDiskHeadroom } from "../../system-health/disk-guard";
import { reclaimSpace } from "../../system-health/reclaim";
import { checkForUpdate, currentVersion, resolveDryRun } from "./check";
import { isNewer } from "./compare";
import * as state from "./state";
import { WATCH_DEADLINE_MS, watchCutover } from "./watch-cutover";

export type ApplyStartResult =
  | { started: true; dryRun: boolean; targetVersion: string }
  | { started: false; reason: "already-running" | "no-update" | "downgrade" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The three otterdeploy images the version tag controls (postgres/redis/crowdsec
 *  are independently pinned and not touched by a version bump). */
const IMAGES = ["server", "builder", "caddy"] as const;

/** Label that marks the detached updater helper container, so the watchdog and
 *  the boot-time sweep can find it. */
const UPDATER_LABEL = "otterdeploy.role=updater";

/** Disk the update must have free before it touches the running stack. A full
 *  `compose pull`/`up` can corrupt redis's AOF and half-recreate the stack,
 *  leaving no control plane, so we refuse (after trying to reclaim) below this.
 *  The server image alone is ~1.2 GB; 2 GB covers a worst-case re-pull + recreate. */
const UPDATE_DISK_RESERVE_BYTES = 2 * 1024 ** 3;

/**
 * Validate + kick off an update. Fire-and-forget: returns as soon as the run is
 * registered so the HTTP response lands before any cutover. Re-checks the
 * release server-side, so a stale client can never force a no-op or downgrade.
 */
/**
 * Boot-time settlement of a handed-off update. The helper recreates the stack
 * out-of-band, so the terminal outcome can only be written by the NEW server
 * once it's up. This compares the booted version against the persisted
 * target and settles the snapshot. Call once during server bootstrap.
 */
export async function finalizeUpdateRunOnBoot(): Promise<void> {
  const succeeded = await state.finalizeHandedOffRun(currentVersion());
  await sweepUpdaterContainers();
  if (succeeded) reclaimAfterUpdate(currentVersion());
}

/**
 * Post-update image sweep. Every version bump leaves the previous release's
 * server/builder/caddy images behind, and nothing ever collected them: a
 * long-lived install accumulates a full ~1.4 GB image set per update until the
 * disk guard trips or an operator runs a manual reclaim.
 *
 * Deliberately fire-and-forget: this runs during bootstrap, and an image prune
 * on a busy daemon can take tens of seconds. Blocking here would delay the
 * control plane coming back for no benefit: the space is not needed yet.
 * Failures are logged and dropped; the disk guard remains the backstop.
 *
 * NOTE: `reclaimSpace(["images"])` prunes every image unused by any container,
 * so the version you just upgraded FROM is removed too. Rollback re-pulls it
 * from the registry rather than finding it locally.
 */
function reclaimAfterUpdate(version: string): void {
  void reclaimSpace(["images"])
    .then(({ reclaimedBytes }) => {
      log.info({ update: { event: "post-update-reclaim", version, reclaimedBytes } });
    })
    .catch((cause: unknown) => {
      log.warn({
        update: { event: "post-update-reclaim", version, status: "failed" },
        error: errText(cause),
      });
    });
}

/**
 * Operator escape hatch (`system.cancelUpdate`): reset a run that's wedged at
 * `running`: the classic case is a real cutover whose helper died without
 * replacing this server, leaving `isRunning()` true forever. Best-effort tears
 * down any lingering updater helper, then flips the run to `failed` so a fresh
 * update can start. No-op if nothing is running.
 */
export async function cancelUpdate(): Promise<{ cancelled: boolean; reason: string }> {
  if (!state.isRunning()) return { cancelled: false, reason: "no-run" };
  // Settle first: the escape hatch must work on the very daemon that wedged
  // the run, so the run is released before any Docker call is made.
  state.cancel(
    "Update reset by operator. The cutover did not complete, and the control plane is still on the previous version.",
  );
  await removeUpdaterContainers({ runningToo: true });
  return { cancelled: true, reason: "reset" };
}

/** A run still `running` this long after it began is wedged, whatever wedged
 *  it: the watchdog's own deadline, plus room for the disk preflight and the
 *  helper-image pull that run before it starts. */
export const STALE_RUN_MS = WATCH_DEADLINE_MS + 15 * 60 * 1_000;

/**
 * Release a run that has been `running` past {@link STALE_RUN_MS}, recording
 * why. The watchdog settles every run it watches, but a step before it (a
 * helper-image pull on a wedged daemon) or a watchdog that never got to run
 * would otherwise hold the run open until an operator found the reset: the
 * Update button stays disabled and every apply answers "already-running".
 * Called on every read of the run and before every apply.
 */
export function settleStaleRun(now: Temporal.Instant = Temporal.Now.instant()): void {
  state.expireIfOlderThan(
    STALE_RUN_MS,
    `Update did not finish within ${Math.round(STALE_RUN_MS / 60_000)} minutes and was marked failed. The control plane is still running the previous version; you can start the update again.`,
    now,
  );
}

/** Remove exited updater helpers left behind by a completed cutover (the happy
 *  path kills this process before it can clean up, so the container lingers).
 *  Skips a still-running helper. That would be a live cutover. */
async function sweepUpdaterContainers(): Promise<void> {
  await removeUpdaterContainers({ runningToo: false });
}

async function removeUpdaterContainers(opts: { runningToo: boolean }): Promise<void> {
  // List and remove are request/response: bounded, so a wedged daemon cannot
  // hold the boot sweep or the operator reset.
  const docker = createRequestDockerClient();
  try {
    const listed = await docker.containers.list({ all: true, filters: { label: [UPDATER_LABEL] } });
    if (listed.isErr()) return;
    for (const c of listed.value) {
      if (!opts.runningToo && c.State === "running") continue;
      await docker.containers.getContainer(c.Id).remove({ force: true });
    }
  } finally {
    docker.destroy();
  }
}

export async function startApply(): Promise<ApplyStartResult> {
  settleStaleRun();
  if (state.isRunning()) return { started: false, reason: "already-running" };

  const check = await checkForUpdate();
  if (!check.updateAvailable || !check.latest) return { started: false, reason: "no-update" };
  if (!isNewer(check.current, check.latest)) return { started: false, reason: "downgrade" };

  const target = check.latest;
  const dryRun = resolveDryRun();
  state.begin(target);

  void run(target, dryRun).catch((cause) => {
    state.finish(false, cause instanceof Error ? cause.message : String(cause));
  });
  return { started: true, dryRun, targetVersion: target };
}

async function run(target: string, dryRun: boolean): Promise<void> {
  if (dryRun) return simulate(target);
  return applyReal(target);
}

async function simulate(target: string): Promise<void> {
  const from = currentVersion();
  state.emit(
    "validate",
    `Dry run. Simulating update from ${from} to ${target}. No containers will be touched.`,
  );
  await sleep(400);
  for (const image of IMAGES) {
    state.emit("pull", `Pulling ${env.OTTERDEPLOY_REGISTRY}/${image}:${target}…`);
    await sleep(450);
    state.emit("pull", `Pulled ${image}.`, "success");
  }
  state.emit("migrate", "Applying database migrations…");
  await sleep(500);
  state.emit("migrate", "Database schema is up to date.", "success");
  state.emit("recreate", "Recreating control-plane containers…");
  await sleep(600);
  state.emit("recreate", "Waiting for the control plane to report healthy…");
  await sleep(700);
  state.emit(
    "done",
    `Simulated update to ${target} complete. In a real update the control plane would restart here and the page would reload.`,
    "success",
  );
  state.finish(true);
}

/** Shell run inside the helper container. Pulls every image BEFORE touching a
 *  running container (a network failure can't half-upgrade you), then recreates
 *  with compose, gating on healthchecks. Migrations run on container boot inside
 *  the new server image (documented follow-up), so there's no separate step. */
function buildHelperScript(target: string, installDir: string): string {
  return [
    "set -e",
    `cd "${installDir}"`,
    'echo "otterdeploy updater: pulling images"',
    // Pull under a process-env override (which beats .env in compose's
    // interpolation order) and only pin .env once the pull has succeeded:
    // a failed pull must leave the install still describing the version
    // that is actually running, not the one it never reached.
    `OTTERDEPLOY_VERSION="${target}" docker compose --env-file .env pull`,
    `echo "otterdeploy updater: pinning OTTERDEPLOY_VERSION=${target}"`,
    // Bump (or add) the pinned version in .env. BusyBox sed (Alpine) supports -i.
    `if grep -q '^OTTERDEPLOY_VERSION=' .env; then sed -i "s|^OTTERDEPLOY_VERSION=.*|OTTERDEPLOY_VERSION=${target}|" .env; else echo "OTTERDEPLOY_VERSION=${target}" >> .env; fi`,
    'echo "otterdeploy updater: recreating stack"',
    "docker compose --env-file .env up -d --remove-orphans --wait --wait-timeout 120",
    'echo "otterdeploy updater: done"',
  ].join("\n");
}

async function applyReal(target: string): Promise<void> {
  const generation = state.currentGeneration();
  const docker = Docker.fromEnv();
  let helperId: string | null;
  try {
    helperId = await launchHelper(docker, target, generation);
  } finally {
    docker.destroy();
  }
  // On the happy path the helper recreates `server`, this process is killed
  // mid-watch, and the NEW server settles the run on boot. The watchdog exists
  // for the UNhappy path: the helper fails (disk full, bad pull, wait-timeout)
  // WITHOUT replacing us, so we survive and must record the failure ourselves.
  // Otherwise the run stays "running" forever and every future apply reports
  // "already-running". The watchdog polls on a REQUEST client (every call
  // bounded) and always settles the run, whatever the daemon does.
  if (helperId) await watchCutover(createRequestDockerClient(), helperId, target);
}

async function launchHelper(
  docker: Docker,
  target: string,
  generation: number,
): Promise<string | null> {
  const installDir = env.OTTERDEPLOY_INSTALL_DIR;
  const helperImage = env.OTTERDEPLOY_UPDATE_HELPER_IMAGE;

  // Disk preflight: BEFORE any handoff or pull. A full disk mid-update can
  // corrupt redis's AOF and leave a half-recreated stack with no control plane
  // (the exact brick this hardening prevents). Try to reclaim unused images +
  // cache first; if still short, ABORT while everything is still running.
  state.emit("validate", "Checking disk headroom for the update…");
  const headroom = await ensureDiskHeadroom({
    neededBytes: UPDATE_DISK_RESERVE_BYTES,
    reclaim: true,
  });
  if (!headroom.ok) {
    state.finish(
      false,
      `Update aborted before touching the stack: ${headroom.reason}. Free disk space and retry.`,
    );
    return null;
  }
  if (headroom.reclaimedBytes > 0) {
    state.emit(
      "validate",
      `Freed ${(headroom.reclaimedBytes / 1024 ** 3).toFixed(1)} GB of unused images/cache to make room.`,
      "success",
    );
  }

  state.emit("validate", `Preparing update to ${target} (install dir ${installDir}).`);
  state.emit("pull", `Ensuring update helper image ${helperImage} is available…`);
  await pullImage(docker, helperImage);
  // A pull that hung long enough for this run to be expired as stale (and a
  // new one begun) must not launch a second helper into someone else's run.
  if (state.currentGeneration() !== generation) return null;

  state.emit(
    "recreate",
    "Launching detached update helper. The control plane will restart when the new images are running. This page will reconnect automatically.",
  );

  // Mark handoff BEFORE starting the helper: once compose recreates `server`,
  // this process dies and can't report the outcome. The stream ends here.
  state.markHandoff();
  log.info({ update: { event: "handoff", target, helperImage } });

  const created = await docker.containers.create({
    Image: helperImage,
    Cmd: ["sh", "-c", buildHelperScript(target, installDir)],
    WorkingDir: installDir,
    Labels: { "otterdeploy.role": "updater", "otterdeploy.target": target },
    HostConfig: {
      // NOT auto-removed: the watchdog needs the exit code + logs to tell a
      // failed cutover apart from a still-running one. The boot sweep (and the
      // watchdog itself) reaps the container afterwards.
      AutoRemove: false,
      Binds: ["/var/run/docker.sock:/var/run/docker.sock", `${installDir}:${installDir}`],
      RestartPolicy: { Name: "no" },
    },
  });
  if (created.isErr()) {
    state.finish(false, `Could not create update helper: ${errText(created.error)}`);
    return null;
  }
  const helper = created.value;
  const start = await helper.start();
  if (start.isErr()) {
    state.finish(false, `Could not start update helper: ${errText(start.error)}`);
    return null;
  }

  return helper.id;
}
