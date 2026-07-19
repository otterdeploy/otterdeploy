/**
 * Apply orchestrator — the self-replacement crux.
 *
 * A compose stack can't `up` itself and survive: recreating the `server`
 * container kills the process mid-command. So the real path is Coolify's trick —
 * launch a DETACHED, auto-removing HELPER container (docker CLI + compose,
 * socket + install-dir mounted) that bumps the pinned version and runs
 * `compose pull && up -d`. The server hands off, ends the progress stream, and
 * the browser polls /health for the new container (Dokploy's reconnection loop).
 *
 * The dry-run path replaces the helper with an in-process simulation that emits
 * the same progress phases and flips nothing — so the entire flow is exercisable
 * locally with no real newer image and no restart. Chosen by resolveDryRun()
 * (dev-default ON), so `bun dev` is safe out of the box.
 */
import { Docker } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { log } from "evlog";

import { pullImage } from "../../runtime/docker-driver-helpers";
import { ensureDiskHeadroom } from "../../system-health/disk-guard";
import { checkForUpdate, currentVersion, resolveDryRun } from "./check";
import { isNewer } from "./compare";
import * as state from "./state";

export type ApplyStartResult =
  | { started: true; dryRun: boolean; targetVersion: string }
  | { started: false; reason: "already-running" | "no-update" | "downgrade" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The three otterdeploy images the version tag controls (postgres/redis/crowdsec
 *  are independently pinned and not touched by a version bump). */
const IMAGES = ["server", "builder", "caddy"] as const;

/** Disk the update must have free before it touches the running stack. A full
 *  `compose pull`/`up` can corrupt redis's AOF and half-recreate the stack,
 *  leaving no control plane — so we refuse (after trying to reclaim) below this.
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
 * once it's up — this compares the booted version against the persisted
 * target and settles the snapshot. Call once during server bootstrap.
 */
export async function finalizeUpdateRunOnBoot(): Promise<void> {
  await state.finalizeHandedOffRun(currentVersion());
}

export async function startApply(): Promise<ApplyStartResult> {
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
    `Dry run — simulating update from ${from} to ${target}. No containers will be touched.`,
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
    `echo "otterdeploy updater: pinning OTTERDEPLOY_VERSION=${target}"`,
    // Bump (or add) the pinned version in .env. BusyBox sed (Alpine) supports -i.
    `if grep -q '^OTTERDEPLOY_VERSION=' .env; then sed -i "s|^OTTERDEPLOY_VERSION=.*|OTTERDEPLOY_VERSION=${target}|" .env; else echo "OTTERDEPLOY_VERSION=${target}" >> .env; fi`,
    'echo "otterdeploy updater: pulling images"',
    "docker compose --env-file .env pull",
    'echo "otterdeploy updater: recreating stack"',
    "docker compose --env-file .env up -d --remove-orphans --wait --wait-timeout 120",
    'echo "otterdeploy updater: done"',
  ].join("\n");
}

async function applyReal(target: string): Promise<void> {
  const installDir = env.OTTERDEPLOY_INSTALL_DIR;
  const helperImage = env.OTTERDEPLOY_UPDATE_HELPER_IMAGE;
  const docker = Docker.fromEnv();

  // Disk preflight — BEFORE any handoff or pull. A full disk mid-update can
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
      `Update aborted before touching the stack — ${headroom.reason}. Free disk space and retry.`,
    );
    return;
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

  state.emit(
    "recreate",
    "Launching detached update helper. The control plane will restart when the new images are running — this page will reconnect automatically.",
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
      AutoRemove: true,
      Binds: ["/var/run/docker.sock:/var/run/docker.sock", `${installDir}:${installDir}`],
      RestartPolicy: { Name: "no" },
    },
  } as Parameters<Docker["containers"]["create"]>[0]);
  if (created.isErr()) {
    state.finish(false, `Could not create update helper: ${errText(created.error)}`);
    return;
  }
  const start = await created.value.start();
  if (start.isErr()) {
    state.finish(false, `Could not start update helper: ${errText(start.error)}`);
    return;
  }
  // Success is intentionally NOT recorded here — the helper is now recreating
  // the stack out-of-band. The browser confirms recovery via /health, then reads
  // the persisted snapshot the NEW server writes on its next boot cycle.
}
