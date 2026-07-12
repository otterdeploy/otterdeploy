import { zId } from "@otterdeploy/shared/id";
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
  /** Where the build source comes from. Absent ⇒ "git" — keeps jobs enqueued
   *  before this field existed (in-flight at deploy time) valid. For "tarball"
   *  the builder extracts the source the CLI uploaded at
   *  sourceTarballPath(projectId, deploymentId) instead of cloning; the git
   *  fields below are then omitted. The worker also reads it to decide whether
   *  to bind-mount the staged tarball into the helper container. */
  sourceKind: z.enum(["git", "tarball"]).optional(),
  // Git identity — present for git builds, omitted for tarball. Optional so a
  // tarball trigger validates without a repo/ref/sha. The builder never reads
  // these off the payload (it resolves everything from the deployment row via
  // load.ts); they remain for the worker's log line + the webhook path.
  gitRepoId: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  sha: z.string().min(1).optional(),
  commitMessage: z.string().optional(),
  commitAuthor: z.string().optional(),
  /** Which PR preview this build targets, if any. Omitted → a normal base
   *  build. A preview build carries its preview id so the worker resolves
   *  refs against preview-scoped branches + names the container per preview. */
  previewId: zId("prev").optional(),
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
