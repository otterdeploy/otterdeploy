/**
 * apps/builder entry point.
 *
 * Single-purpose process: pulls `deploy.triggered` jobs off the queue and
 * spawns a throwaway helper container per deployment to run the build (see
 * handler.ts + build-one.ts). The worker itself only needs the docker CLI and
 * a socket to launch those containers: the railpack toolchain and the
 * pipeline run inside them. Lives apart from apps/server, which shouldn't
 * depend on docker at all.
 *
 * Concurrency is configurable via BUILDER_CONCURRENCY (default 1). The queue
 * this process drains is its deploy LANE (BUILDER_LANE, default "default"):
 * a lane-named builder consumes `deploy.triggered.<lane>` so installs with
 * several build servers drain their queues concurrently, while the default
 * builder keeps consuming the plain `deploy.triggered` queue unchanged.
 */

import { builderConcurrency } from "@otterdeploy/api/lib/platform-runtime-settings";
import { env } from "@otterdeploy/env/server";
import {
  createWorkers,
  deployQueueName,
  reconcileInterruptedDeployments,
  registerDeployLane,
} from "@otterdeploy/jobs";
import { Result } from "better-result";
import { log } from "evlog";

import type { LogSink } from "./log-stream";

import {
  BUILD_SANDBOX_IMAGE,
  buildHelpersRunning,
  ensureBuildSandbox,
  writeBuildSandboxStatus,
} from "./build-sandbox";
import { makeBuildJob } from "./handler";
import { reapOrphanHelpers } from "./helper-reaper";
import { getDeploymentStatus } from "./state";

let stop: (() => Promise<void>) | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

// Sweep orphaned pending/building deployments: at boot AND on a cadence. A row
// can be stranded any time (a build container that dies mid-run, a job that
// never starts), not only across a restart, so a boot-only sweep left post-boot
// orphans stuck forever. Redis-lock-guarded + idempotent, so running it
// periodically (and across multiple builder replicas) is safe.
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/** A LogSink for the builder's own housekeeping: lines go to the process log,
 *  not to a deployment. */
function housekeepingSink(event: string): LogSink {
  return {
    write: () => undefined,
    system: (line) => log.info({ builder: { event, line } }),
    setPhase: () => undefined,
    close: async () => undefined,
  };
}

/**
 * Provision (or heal) the rootless build sandbox and record the outcome for
 * System health (od-48w). Runs at boot and on every reconcile tick, so an
 * in-app upgrade, a removed container or a stopped one all converge without
 * the installer. Never throws; builds re-check on their own and fail closed.
 */
async function checkBuildSandbox(trigger: "boot" | "interval"): Promise<void> {
  if (env.BUILDER_ALLOW_UNISOLATED && env.BUILDKIT_HOST.trim() === "") {
    await writeBuildSandboxStatus({
      state: "unisolated",
      reason: "BUILDER_ALLOW_UNISOLATED=true",
      image: "",
    });
    return;
  }
  if (env.BUILDKIT_HOST.trim() !== "") return; // operator-managed BuildKit
  const sink = housekeepingSink("build-sandbox");
  // Recreating the sandbox kills every build in it, so a spec update waits
  // for a moment with no build helper running.
  const recreateOnDrift = !(await buildHelpersRunning(sink));
  const ready = await ensureBuildSandbox(sink, { recreateOnDrift });
  if (ready.isOk()) {
    log.info({ builder: { event: "build-sandbox-ready", trigger } });
    await writeBuildSandboxStatus({ state: "ready", reason: null, image: BUILD_SANDBOX_IMAGE });
    return;
  }
  log.error({ builder: { event: "build-sandbox-failed", trigger, reason: ready.error.reason } });
  await writeBuildSandboxStatus({
    state: "failed",
    reason: ready.error.reason,
    image: BUILD_SANDBOX_IMAGE,
  });
}

async function runReconcile(trigger: "boot" | "interval"): Promise<void> {
  (
    await Result.tryPromise({
      try: () => reconcileInterruptedDeployments(),
      catch: (cause) => cause,
    })
  ).match({
    ok: (summary) => log.info({ builder: { event: "reconciled", trigger, ...summary } }),
    err: (cause) =>
      log.warn({ builder: { event: "reconcile-failed", trigger, cause: String(cause) } }),
  });
  // After the row sweep, so a row it just failed takes its orphaned helper
  // with it on the same pass.
  const reaped = await reapOrphanHelpers({ status: getDeploymentStatus });
  if (reaped.length > 0) log.warn({ builder: { event: "orphan-helpers-reaped", trigger, reaped } });
  await checkBuildSandbox(trigger);
}

async function bootstrap() {
  // Settings-backed (seeded from BUILDER_CONCURRENCY). BullMQ fixes a worker's
  // concurrency when it's constructed, so this is read exactly once, here,
  // which is why the settings card says a change needs the builder restarted
  // rather than implying it takes effect live.
  const concurrency = await builderConcurrency();
  const lane = env.BUILDER_LANE;
  log.info({ builder: { event: "starting", concurrency, lane } });

  // Register the lane up front (enqueuers also register on every trigger).
  // Best-effort insurance so queue readers can enumerate this lane even
  // before its first job arrives; if Redis is down, the worker below fails
  // loudly on its own.
  await registerDeployLane(lane).catch(() => undefined);

  // Reset deployments stranded before we start pulling new jobs. Best-effort:
  // a reconcile failure must never block the worker.
  await runReconcile("boot");

  const workers = await createWorkers({
    jobs: [makeBuildJob()],
    concurrency,
    // Bind the deploy worker to THIS builder's lane queue. The handler is the
    // same on every lane; only the queue it consumes differs.
    queueNameFor: () => deployQueueName(lane),
  });
  stop = workers.stop;

  // Keep sweeping on a cadence so orphans created after boot don't sit forever.
  reconcileTimer = setInterval(() => void runReconcile("interval"), RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();

  log.info({ builder: { event: "ready" } });
}

void bootstrap();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    log.info({ builder: { event: "draining", signal } });
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (stop) await stop().catch(() => undefined);
    process.exit(0);
  });
}
