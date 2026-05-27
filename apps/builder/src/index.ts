/**
 * apps/builder entry point.
 *
 * Single-purpose process: pulls `deploy.triggered` jobs off the queue
 * and runs the build pipeline. Lives apart from apps/server because it
 * needs the `nixpacks` binary, the docker CLI, and a docker socket —
 * none of which the API process should depend on.
 *
 * Concurrency is configurable via BUILDER_CONCURRENCY (default 1).
 */

import { env } from "@otterstack/env/server";
import { createWorkers } from "@otterstack/jobs";
import { log } from "evlog";

import { makeBuildJob } from "./handler";
import { createPublisher } from "./redis";

let stop: (() => Promise<void>) | null = null;
let publisher: ReturnType<typeof createPublisher> | null = null;

async function bootstrap() {
  log.info({ builder: { event: "starting", concurrency: env.BUILDER_CONCURRENCY } } as Record<
    string,
    unknown
  >);

  publisher = createPublisher();
  const job = makeBuildJob(publisher);

  const workers = await createWorkers({
    jobs: [job],
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
    if (publisher) publisher.close();
    process.exit(0);
  });
}
