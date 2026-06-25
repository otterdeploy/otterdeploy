// Fan-in log stream that multiplexes every resource in a project into a
// single subscription. Per-resource subscriptions still exist
// (resource.logs.tail) — this one is for the project-wide /logs page where
// the operator wants to see everything at once.

import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, projectNotFoundErrors, tag } from "./shared";
import { resourceLogEventSchema } from "./logs";
import { projectIdField, resourceIdField } from "./shared";

export const projectLogEventSchema = resourceLogEventSchema.extend({
  // Project-level control lines ("Tailing N services", "Project not found")
  // aren't tied to a resource and carry "". Real log lines carry a branded id.
  resourceId: z.union([resourceIdField, z.literal("")]),
  serviceName: z.string(),
});

export const projectLogsTailInput = z.object({
  projectId: projectIdField,
  // Whitelist of resource ids to follow. Empty / undefined = every service
  // resource in the project (databases are excluded by default — they have
  // their own log surface on the resource detail panel).
  resourceIds: z.array(resourceIdField).optional(),
  tail: z.number().int().min(0).max(500).optional().default(50),
});

export const projectLogsContractSlice = {
  logs: {
    tail: oc
      .errors(projectNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/logs`,
        tag,
        method: "GET",
      })
      .input(projectLogsTailInput)
      .output(eventIterator(projectLogEventSchema)),
  },
};
