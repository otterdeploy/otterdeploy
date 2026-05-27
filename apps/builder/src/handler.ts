/**
 * The `deploy.triggered` BullMQ handler — replaces the stub in
 * `packages/jobs/src/jobs/deploy.ts`. Iterates the deployments named in
 * the payload and runs the build pipeline for each, in series.
 *
 * Series rather than parallel because docker builds of unrelated
 * services on the same builder host contend for the daemon and the
 * disk cache more than they parallelize — better to keep deploys
 * predictable. Cross-deployment parallelism is the job of running
 * multiple builder hosts (or bumping BUILDER_CONCURRENCY).
 */

import { defineJob } from "@otterstack/jobs";
import { DeployTriggeredPayload, deployTriggeredJob } from "@otterstack/jobs/jobs/deploy";
import type { Redis } from "ioredis";

import { runBuildPipeline } from "./pipeline";

import type { Id, ID_PREFIX } from "@otterstack/shared/id";

type DeploymentId = Id<typeof ID_PREFIX.deployment>;

export function makeBuildJob(publisher: Redis) {
  return defineJob({
    name: deployTriggeredJob.name,
    schema: DeployTriggeredPayload,
    opts: deployTriggeredJob.opts,
    async handler(payload, { log }) {
      log.info({
        build: {
          event: "received",
          projectId: payload.projectId,
          gitRepoId: payload.gitRepoId,
          sha: payload.sha,
          deploymentCount: payload.deploymentIds.length,
        },
      });

      const results: Array<{
        deploymentId: string;
        ok: boolean;
        image?: string;
        error?: string;
      }> = [];

      for (const id of payload.deploymentIds) {
        const result = await runBuildPipeline({
          deploymentId: id as DeploymentId,
          publisher,
        });
        results.push({
          deploymentId: id,
          ok: result.ok,
          ...(result.ok ? { image: result.image } : { error: result.error }),
        });
      }

      log.info({
        build: {
          event: "batch-complete",
          projectId: payload.projectId,
          sha: payload.sha,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
      });
      return { results };
    },
  });
}
