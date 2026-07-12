/**
 * Deployment history schemas + slice.
 *
 * One row = one logical "push" of the resource. Each create / env-change /
 * redeploy inserts a row + tags the swarm spec; tasks group under their
 * deployment via the `otterdeploy.deployment.id` label on the task's spec.
 */

import { eventIterator, oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { resourceLogEventSchema } from "./logs";
import { serviceTaskSchema } from "./service-tasks";
import { basePath, resourceNotFoundErrors, tag } from "./shared";
import { deploymentIdField, projectIdField, resourceIdField } from "./shared";

/**
 * A swarm task under one specific deployment. Extends the shared service-task
 * shape with the (project, resource, deployment) ids so the client collection
 * can scope subsets by them via `where` filters (loadSubset). The sibling
 * service-task endpoints keep the plain `serviceTaskSchema`.
 */
const deploymentTaskSchema = serviceTaskSchema.extend({
  projectId: projectIdField,
  resourceId: resourceIdField,
  deploymentId: deploymentIdField,
});

export const deploymentSchema = z.object({
  id: deploymentIdField,
  projectId: projectIdField,
  resourceId: resourceIdField,
  image: z.string(),
  reason: z.enum([
    "create",
    "redeploy",
    "env-change",
    "image-change",
    "restart",
    "git-push",
    "rollback",
  ]),
  // `crashed`/`starting` are derived-only (computed live from task states) —
  // never stored DB values; see DerivedDeploymentStatus.
  status: z.enum([
    "pending",
    "building",
    "starting",
    "running",
    "crashed",
    "failed",
    "superseded",
    "removed",
  ]),
  errorMessage: z.string().nullable(),
  taskCount: z.number().int(),
  failedTaskCount: z.number().int(),
  runningTaskCount: z.number().int(),
  // Restart-policy attempts observed on the live container (docker
  // RestartCount, or swarm failed-task count) and the configured cap.
  // restartMaxAttempts null = unlimited.
  restartCount: z.number().int().nullable(),
  restartMaxAttempts: z.number().int().nullable(),
  // Git provenance — populated when the deploy was built from a repo
  // (reason="git-push" or a git-sourced service). Null for image-only /
  // database deployments. Surfaced in the "Deployed from" block of the
  // deployment Details tab.
  gitSha: z.string().nullable(),
  gitRef: z.string().nullable(),
  gitCommitMessage: z.string().nullable(),
  gitCommitAuthor: z.string().nullable(),
  // Content hash of an uploaded source tarball (source:"upload") — the upload
  // analog of gitSha. Null for git / image-only deploys.
  sourceSha: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const deploymentListInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** Scope to one PR preview's deployments. Omitted → base rows only. */
  previewId: zId(ID_PREFIX.preview).optional(),
});

export const deploymentTasksInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  deploymentId: deploymentIdField,
});

export const deploymentLogsTailInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  deploymentId: deploymentIdField,
  tail: z.number().int().min(0).max(2000).optional().default(500),
});

/**
 * One line of the builder pipeline's output (git clone → build → push),
 * persisted in `deployment_log` and live-published over Redis. `seq` is the
 * DB insert-order id for scrollback rows (the event-iterator id used for
 * `lastEventId` resume) and null for live lines that haven't been flushed to
 * the DB yet. Distinct from `resourceLogEventSchema` (docker task tails),
 * which has no durable sequence.
 */
const deploymentBuildLogEventSchema = z.object({
  seq: z.number().int().nullable(),
  stream: z.enum(["stdout", "stderr", "system"]),
  line: z.string(),
  ts: z.string(),
});

const deploymentBuildLogsInput = z.object({
  deploymentId: deploymentIdField,
});

export const deploymentsContractSlice = {
  // Deployment history: one row per `docker service create / update`
  // we did. Status is live-derived from underlying tasks.
  list: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}/deployments`,
      tag,
      method: "GET",
    })
    .input(deploymentListInput)
    .output(z.array(deploymentSchema)),

  // Tasks scheduled under one specific deployment (matched by the
  // `otterdeploy.deployment.id` label on each task's container spec).
  tasks: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}/deployments/{deploymentId}/tasks`,
      tag,
      method: "GET",
    })
    .input(deploymentTasksInput)
    .output(z.array(deploymentTaskSchema)),

  // Streaming logs aggregated across every task under a deployment.
  // Powers the Deploy Logs tab in the deployment-detail route.
  logs: {
    tail: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/deployments/{deploymentId}/logs`,
        tag,
        method: "GET",
      })
      .input(deploymentLogsTailInput)
      .output(eventIterator(resourceLogEventSchema)),
  },

  // Streaming logs from the BUILD pipeline (git clone → build → push) the
  // builder publishes via Redis + persists in `deployment_log`. Powers the
  // Build Logs tab. Keyed by deploymentId alone — org ownership is derived
  // from the deployment row. Supports `lastEventId` resume via the line seq.
  buildLogs: {
    stream: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/deployments/{deploymentId}/build-logs`,
        tag,
        method: "GET",
      })
      .input(deploymentBuildLogsInput)
      .output(eventIterator(deploymentBuildLogEventSchema)),
  },
};
