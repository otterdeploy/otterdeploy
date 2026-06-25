/**
 * Deployment history schemas + slice.
 *
 * One row = one logical "push" of the resource. Each create / env-change /
 * redeploy inserts a row + tags the swarm spec; tasks group under their
 * deployment via the `otterdeploy.deployment.id` label on the task's spec.
 */

import { eventIterator, oc } from "@orpc/contract";
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
  reason: z.enum(["create", "redeploy", "env-change", "image-change", "restart", "git-push", "rollback"]),
  status: z.enum([
    "pending",
    "building",
    "running",
    "failed",
    "superseded",
    "removed",
  ]),
  errorMessage: z.string().nullable(),
  taskCount: z.number().int(),
  failedTaskCount: z.number().int(),
  runningTaskCount: z.number().int(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const deploymentListInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
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
