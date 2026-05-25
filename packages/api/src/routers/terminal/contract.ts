/**
 * Discovery contract for the in-app terminal picker. Returns the set of
 * targets the operator can attach a shell to right now — exec containers
 * + database consoles. SSH targets live on `server.list` (org-wide nodes).
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId, zSlug } from "@otterstack/shared/id";

const tag = "terminal";
const basePath = "/terminal";

export const terminalContainerSchema = z.object({
  /** Container id — passed to /pty?container=… to start the exec. */
  containerId: z.string(),
  /** Display name (last segment of docker Names, slash-stripped). */
  name: z.string(),
  /** Image string for context display under the container row. */
  image: z.string(),
  /** Docker state ("running", "exited", …). Only "running" can be exec'd. */
  state: z.string(),
  /** otterstack.resource.type label value (drives picker grouping). */
  resourceType: z.enum(["service", "postgres"]),
  /** Project slug (otterstack.project label). May be null on legacy rows. */
  projectSlug: zSlug(ID_PREFIX.project).nullable(),
  /** Friendly project name resolved from the DB. Null if the project slug
   *  isn't an active project in this org. */
  projectName: z.string().nullable(),
  /** Resource id (otterstack.resource.id label). Services only. */
  serviceResourceId: zId(ID_PREFIX.resource).nullable(),
  /** Swarm service name — the part before the .slot.taskId suffix. */
  serviceName: z.string().nullable(),
  /** Replica slot ("1", "2", …) parsed out of the swarm task name. */
  replicaSlot: z.string().nullable(),
});

export const terminalDatabaseSchema = z.object({
  resourceId: zId(ID_PREFIX.resource),
  name: z.string(),
  engine: z.string(),
  projectSlug: zSlug(ID_PREFIX.project),
  projectName: z.string(),
});

export const terminalTargetsSchema = z.object({
  containers: z.array(terminalContainerSchema),
  databases: z.array(terminalDatabaseSchema),
});

export const listTargetsInput = z.void();

export const terminalContract = {
  targets: oc
    .meta({ path: `${basePath}/targets`, tag, method: "GET" })
    .input(listTargetsInput)
    .output(terminalTargetsSchema),
};
