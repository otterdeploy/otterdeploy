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
 * Concurrency is configurable via BUILDER_CONCURRENCY (default 1).
 */

import { builderConcurrency } from "@otterdeploy/api/lib/platform-runtime-settings";
import { createWorkers, reconcileInterruptedDeployments } from "@otterdeploy/jobs";
import { Result } from "better-result";
import { log } from "evlog";

import { makeBuildJob } from "./handler";

let stop: (() => Promise<void>) | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

// Sweep orphaned pending/building deployments: at boot AND on a cadence. A row
// can be stranded any time (a build container that dies mid-run, a job that
// never starts), not only across a restart, so a boot-only sweep left post-boot
// orphans stuck forever. Redis-lock-guarded + idempotent, so running it
// periodically (and across multiple builder replicas) is safe.
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

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
}

async function bootstrap() {
  // Settings-backed (seeded from BUILDER_CONCURRENCY). BullMQ fixes a worker's
  // concurrency when it's constructed, so this is read exactly once, here,
  // which is why the settings card says a change needs the builder restarted
  // rather than implying it takes effect live.
  const concurrency = await builderConcurrency();
  log.info({ builder: { event: "starting", concurrency } });

  // Reset deployments stranded before we start pulling new jobs. Best-effort:
  // a reconcile failure must never block the worker.
  await runReconcile("boot");

  const workers = await createWorkers({
    jobs: [makeBuildJob()],
    concurrency,
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
