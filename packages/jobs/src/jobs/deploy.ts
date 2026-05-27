import * as z from "zod";

import { defineJob } from "../define";

/**
 * Triggered when a git push arrives for a repo bound to a project.
 *
 * Phase 1: handler logs the payload only — the real build pipeline (clone,
 * docker build, registry push, swarm service update) lands in Phase 3+.
 * Deployment rows are still inserted by the webhook receiver so the UI
 * shows the queued deploy.
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
