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
import { Docker, demuxStream } from "@otterdeploy/docker";
import { env } from "@otterdeploy/env/server";
import { log } from "evlog";
import type { Readable } from "node:stream";

import { pullImage } from "../../runtime/docker-driver-helpers";
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

/** Label that marks the detached updater helper container, so the watchdog and
 *  the boot-time sweep can find it. */
const UPDATER_LABEL = "otterdeploy.role=updater";

/** How often the watchdog inspects the helper, and the hard backstop after which
 *  a cutover that never reported back is declared failed so the UI un-wedges.
 *  The helper's own `up -d --wait --wait-timeout 120` plus image-pull time fits
 *  comfortably inside this; the deadline only bites if the helper vanishes or
 *  hangs. */
const WATCH_POLL_MS = 3_000;
const WATCH_DEADLINE_MS = 15 * 60 * 1_000;

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
  await sweepUpdaterContainers();
}

/**
 * Operator escape hatch (`system.cancelUpdate`): reset a run that's wedged at
 * `running` — the classic case is a real cutover whose helper died without
 * replacing this server, leaving `isRunning()` true forever. Best-effort tears
 * down any lingering updater helper, then flips the run to `failed` so a fresh
 * update can start. No-op if nothing is running.
 */
export async function cancelUpdate(): Promise<{ cancelled: boolean; reason: string }> {
  if (!state.isRunning()) return { cancelled: false, reason: "no-run" };
  await removeUpdaterContainers({ runningToo: true });
  state.cancel(
    "Update reset by operator — the cutover did not complete, and the control plane is still on the previous version.",
  );
  return { cancelled: true, reason: "reset" };
}

/** Remove exited updater helpers left behind by a completed cutover (the happy
 *  path kills this process before it can clean up, so the container lingers).
 *  Skips a still-running helper — that would be a live cutover. */
async function sweepUpdaterContainers(): Promise<void> {
  await removeUpdaterContainers({ runningToo: false });
}

async function removeUpdaterContainers(opts: { runningToo: boolean }): Promise<void> {
  const docker = Docker.fromEnv();
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
      // NOT auto-removed: the watchdog needs the exit code + logs to tell a
      // failed cutover apart from a still-running one. The boot sweep (and the
      // watchdog itself) reaps the container afterwards.
      AutoRemove: false,
      Binds: ["/var/run/docker.sock:/var/run/docker.sock", `${installDir}:${installDir}`],
      RestartPolicy: { Name: "no" },
    },
  } as Parameters<Docker["containers"]["create"]>[0]);
  if (created.isErr()) {
    state.finish(false, `Could not create update helper: ${errText(created.error)}`);
    return;
  }
  const helper = created.value;
  const start = await helper.start();
  if (start.isErr()) {
    state.finish(false, `Could not start update helper: ${errText(start.error)}`);
    return;
  }

  // On the happy path the helper recreates `server`, this process is killed
  // mid-watch, and the NEW server settles the run on boot. The watchdog exists
  // for the UNhappy path: the helper fails (disk full, bad pull, wait-timeout)
  // WITHOUT replacing us, so we survive and must record the failure ourselves —
  // otherwise the run stays "running" forever and every future apply reports
  // "already-running". Resolve the id via inspect (well-typed, matches the rest
  // of the codebase); skip the watchdog only if we can't (nothing else to do).
  const idRes = await helper.inspect();
  const helperId = idRes.isOk() ? idRes.value.Id : null;
  if (helperId) await watchCutover(docker, helperId, target);
}

/** Poll the detached helper to its exit; record the terminal outcome the old
 *  server would otherwise never write. A no-op on the happy path — this process
 *  is gone before the loop notices success. */
async function watchCutover(docker: Docker, helperId: string, target: string): Promise<void> {
  const container = docker.containers.getContainer(helperId);
  const deadlineAt = Date.now() + WATCH_DEADLINE_MS;
  try {
    while (Date.now() < deadlineAt) {
      await sleep(WATCH_POLL_MS);
      const inspected = await container.inspect();
      if (inspected.isErr()) continue; // transient socket blip — let the deadline decide
      const st = inspected.value.State;
      if (st?.Running !== false) continue; // still pulling / recreating
      // Helper has exited. If it succeeded AND we somehow booted the target,
      // it's done; otherwise the cutover did not replace us — a failure.
      const exitCode = st?.ExitCode ?? 0;
      const reachedTarget = currentVersion() === target || isNewer(currentVersion(), target);
      const logs = await readHelperLogs(container);
      if (exitCode === 0 && reachedTarget) {
        state.emit("done", `Update to ${target} complete — control plane is running ${currentVersion()}.`, "success");
        state.finish(true);
      } else {
        const why =
          exitCode === 0
            ? `finished but the control plane is still on ${currentVersion()} (expected ${target})`
            : `failed (exit ${exitCode})`;
        const msg = `Update helper ${why}. The control plane was not replaced and is still running the previous version.${logs ? `\n${logs}` : ""}`;
        state.emit("done", msg, "error");
        state.finish(false, msg);
      }
      await container.remove({ force: true });
      return;
    }
    const msg = `Update to ${target} did not complete within ${Math.round(WATCH_DEADLINE_MS / 60_000)} minutes. The control plane is still running the previous version — inspect the update helper container for details.`;
    state.emit("done", msg, "error");
    state.finish(false, msg);
    await container.remove({ force: true });
  } finally {
    docker.destroy();
  }
}

/** Tail the helper's combined output for the failure message. Best-effort — an
 *  empty string when logs can't be read. */
async function readHelperLogs(container: ReturnType<Docker["containers"]["getContainer"]>): Promise<string> {
  const res = await container.logs({ follow: false, stdout: true, stderr: true, tail: "40" });
  if (res.isErr()) return "";
  const { stdout, stderr } = demuxStream(res.value as Readable);
  const [out, err] = await Promise.all([collect(stdout), collect(stderr)]);
  const text = `${out.toString("utf8")}${err.toString("utf8")}`.trim();
  return text ? `Helper output:\n${text.slice(-1500)}` : "";
}

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
