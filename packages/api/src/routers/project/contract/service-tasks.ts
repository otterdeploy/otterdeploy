/**
 * Service-task schemas + `serviceTasks` slice.
 *
 * `state` is the high-level bucket used by the graph (running/building/error);
 * finer-grained docker states are collapsed into these so the UI doesn't have
 * to know about preparing / accepted / orphaned distinctions. `rawState`
 * preserves the original docker value for the deployment-detail panel.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterstack/shared/id";

import { basePath, projectNotFoundErrors, tag } from "./shared";

export const serviceTaskSchema = z.object({
  id: z.string(),
  slot: z.number().int().nullable(),
  /** "<serviceName>.<slot>", e.g. "api.1". Matches docker's display name. */
  label: z.string(),
  state: z.enum(["running", "building", "error"]),
  /** Raw docker task state — "running" / "starting" / "preparing" / "failed"
   *  / "shutdown" / etc. The graph uses the collapsed `state` above; the
   *  deployment-detail panel surfaces the raw value so the operator can
   *  tell "still pulling the image" from "fully started". */
  rawState: z.string().nullable(),
  /** What swarm WANTED the task to be ("running" / "shutdown"). When the
   *  container's actual state diverges from this, swarm is mid-roll. */
  desiredState: z.string().nullable(),
  /** Swarm node id the task was scheduled onto, or null if unscheduled. */
  nodeId: z.string().nullable(),
  /** Last reported message from the orchestrator. */
  message: z.string().nullable(),
  /** Status.Err — the human-readable reason a task entered a failed state. */
  error: z.string().nullable(),
  /** Container id assigned to this task, if any. Available once swarm has
   *  reached at least "preparing" — earlier states (new / pending) have no
   *  container yet. */
  containerId: z.string().nullable(),
  /** Container exit code, when the task is in a terminal state. */
  exitCode: z.number().int().nullable(),
  timestamp: z.string().nullable(),
});

export const serviceTasksSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  tasks: z.array(serviceTaskSchema),
});

export const listServiceTasksInput = z.object({
  projectId: zId(ID_PREFIX.project),
});

export const serviceTasksContractSlice = oc
  .errors(projectNotFoundErrors)
  .meta({
    path: `${basePath}/{projectId}/service-tasks`,
    tag,
    method: "GET",
  })
  .input(listServiceTasksInput)
  .output(z.array(serviceTasksSchema));
