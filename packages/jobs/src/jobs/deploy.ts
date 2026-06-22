import * as z from "zod";

import { defineJob } from "../define";

/**
 * Triggered when a git push arrives for a repo bound to a project (also enqueued
 * by manual rebuilds, manifest applies, and compose deploys).
 *
 * The real work lives in `apps/builder/src/handler.ts` (`makeBuildJob`), which
 * registers the `deploy.triggered` worker that OWNS the full pipeline — git
 * clone @ sha → build (railpack/Dockerfile/compose) → push → swarm rollout —
 * running each deployment in a throwaway docker container for isolation.
 * `apps/server` deliberately excludes `deploy.triggered` from its in-process
 * workers (it needs the railpack/docker toolchain), so the builder host runs it.
 * The inline `handler` below is only a fallback acknowledgement for environments
 * with no builder attached; the builder's worker supersedes it. Deployment rows
 * are pre-inserted by the enqueuing caller so the UI shows the queued deploy
 * before the build starts.
 */
export const DeployTriggeredPayload = z.object({
  projectId: z.string().min(1),
  gitRepoId: z.string().min(1),
  ref: z.string().min(1),
  sha: z.string().min(1),
  commitMessage: z.string().optional(),
  commitAuthor: z.string().optional(),
  /** Deployment rows pre-inserted by the webhook receiver. The build worker
   *  transitions each through pending → building → running|failed. */
  deploymentIds: z.array(z.string().min(1)),
});
export type DeployTriggeredPayload = z.infer<typeof DeployTriggeredPayload>;

export const deployTriggeredJob = defineJob({
  name: "deploy.triggered",
  schema: DeployTriggeredPayload,
  opts: {
    attempts: 1,
    removeOnComplete: { age: 60 * 60 * 24 * 7 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
  async handler(payload, { log }) {
    log.info({
      deploy: {
        step: "triggered",
        projectId: payload.projectId,
        gitRepoId: payload.gitRepoId,
        ref: payload.ref,
        sha: payload.sha,
        deploymentCount: payload.deploymentIds.length,
      },
    });
    return { acknowledged: true, deploymentIds: payload.deploymentIds };
  },
});
