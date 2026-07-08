/**
 * One-shot build entrypoint — runs the pipeline for a SINGLE deployment,
 * then exits. This is the command each per-build helper container runs: the
 * BullMQ worker (handler.ts) spawns a throwaway `docker run --rm` container
 * per deployment and invokes this.
 *
 * The build's logs and deployment-state writes happen from here (the pipeline
 * holds its own DB + Redis handles), so the live log tail works regardless of
 * the container boundary — the worker only needs the exit code.
 *
 *   exit 0 — built and deployed
 *   exit 1 — pipeline ran and failed (the row is already marked failed here)
 *   exit 2 — invoked without a deployment id (misuse)
 */

import type { DeploymentId } from "@otterdeploy/shared/id";

import { log } from "evlog";

import { runBuildPipeline } from "./pipeline";
import { createPublisher } from "./redis";

async function main(): Promise<never> {
  const deploymentId = process.argv[2] as DeploymentId | undefined;
  if (!deploymentId) {
    log.error({
      build: { event: "build-one-missing-id" },
    } as Record<string, unknown>);
    process.exit(2);
  }

  const publisher = createPublisher();
  const result = await runBuildPipeline({ deploymentId, publisher });
  publisher.close();

  if (result.isErr()) {
    log.warn({
      build: { event: "build-one-failed", deploymentId },
      error: result.error,
    } as Record<string, unknown>);
    process.exit(1);
  }

  log.info({
    build: { event: "build-one-ok", deploymentId, image: result.value },
  } as Record<string, unknown>);
  process.exit(0);
}

// Pessimistic default: if the event loop drains before main() finishes, bun
// exits with THIS code instead of ever reaching a process.exit() above. That
// genuinely happens — Bun 1.3.14 intermittently loses a DB/Redis promise
// during the cache client's initial connect (observed at ~8-24% of helper
// runs), and neither the SQL pool nor the Redis socket holds the loop alive.
// Without this default the process died silently with 0 and the worker
// mistook a never-started build for success. Every explicit exit overrides it.
process.exitCode = 1;

void main();
