/**
 * Streaming log endpoints — both resource-wide and per-task.
 *
 * Both use eventIterator(resourceLogEventSchema) so the client gets the same
 * shape regardless of which endpoint it subscribes to. `system`-stream events
 * carry control messages from the streamer (e.g. "no running container yet"),
 * not actual container output.
 */

import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, resourceNotFoundErrors, tag } from "./shared";
import { projectIdField, resourceIdField } from "./shared";

export const resourceLogEventSchema = z.object({
  stream: z.enum(["stdout", "stderr", "system"]),
  line: z.string(),
  ts: z.string().nullable(),
});

const resourceLogsTailInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** Number of historical lines to replay before live-tailing. */
  tail: z.number().int().min(0).max(1000).optional().default(100),
});

const resourceTaskLogsTailInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  /** Swarm task id. Returned by `project.resource.tasks`. */
  taskId: z.string().min(1),
  tail: z.number().int().min(0).max(2000).optional().default(500),
});

export const logsContractSlice = {
  logs: {
    // Streaming endpoint — yields one event per demuxed log line as docker
    // emits them. Generic across postgres + service resources via the
    // resource → swarm-service → running container resolver in the handler.
    tail: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/logs`,
        tag,
        method: "GET",
      })
      .input(resourceLogsTailInput)
      .output(eventIterator(resourceLogEventSchema)),
  },

  taskLogs: {
    // Streaming endpoint scoped to ONE swarm task. Powers the
    // deployment-detail expander: click a row in Recent deployments to see
    // its swarm-state progression + that specific container's stdout/stderr
    // (exited tasks included — docker keeps the logs on disk).
    tail: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/tasks/{taskId}/logs`,
        tag,
        method: "GET",
      })
      .input(resourceTaskLogsTailInput)
      .output(eventIterator(resourceLogEventSchema)),
  },
};
