/**
 * apps/builder entry point.
 *
 * Single-purpose process: pulls `deploy.triggered` jobs off the queue and
 * spawns a throwaway helper container per deployment to run the build (see
 * handler.ts + build-one.ts). The worker itself only needs the docker CLI and
 * a socket to launch those containers — the railpack toolchain and the
 * pipeline run inside them. Lives apart from apps/server, which shouldn't
 * depend on docker at all.
 *
 * Concurrency is configurable via BUILDER_CONCURRENCY (default 1).
 */

import { env } from "@otterdeploy/env/server";
import {
  createWorkers,
  reconcileInterruptedDeployments,
} from "@otterdeploy/jobs";
import { Result } from "better-result";
import { log } from "evlog";

import { makeBuildJob } from "./handler";

let stop: (() => Promise<void>) | null = null;

async function bootstrap() {
  log.info({ builder: { event: "starting", concurrency: env.BUILDER_CONCURRENCY } } as Record<
    string,
    unknown
  >);

  // Reset deployments stranded by a previous crash before we start pulling
  // new jobs. Best-effort: a reconcile failure must never block the worker.
  (
    await Result.tryPromise({
      try: () => reconcileInterruptedDeployments(),
      catch: (cause) => cause,
    })
  ).match({
    ok: (summary) =>
      log.info({ builder: { event: "reconciled", ...summary } } as Record<
        string,
        unknown
      >),
    err: (cause) =>
      log.warn({ builder: { event: "reconcile-failed", cause: String(cause) } } as Record<
        string,
        unknown
      >),
  });

  const workers = await createWorkers({
    jobs: [makeBuildJob()],
    concurrency: env.BUILDER_CONCURRENCY,
  });
  stop = workers.stop;

  log.info({ builder: { event: "ready" } } as Record<string, unknown>);
}

void bootstrap();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    log.info({ builder: { event: "draining", signal } } as Record<string, unknown>);
    if (stop) await stop().catch(() => undefined);
    process.exit(0);
  });
}
