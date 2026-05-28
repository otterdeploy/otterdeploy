/**
 * Discovery contract for the in-app terminal picker. Returns the set of
 * targets the operator can attach a shell to right now — exec containers
 * + database consoles. SSH targets live on `server.list` (org-wide nodes).
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";

import { oc } from "@orpc/contract";
import * as z from "zod";
import { resourceIdField } from "../project/contract/shared";

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
  /** otterdeploy.resource.type label value (drives picker grouping). */
  resourceType: z.enum(["service", "postgres", "redis", "mariadb", "mongodb"]),
  /** Project slug (otterdeploy.project label). May be null on legacy rows. */
  projectSlug: zSlug(ID_PREFIX.project).nullable(),
  /** Friendly project name resolved from the DB. Null if the project slug
   *  isn't an active project in this org. */
  projectName: z.string().nullable(),
  /** Resource id (otterdeploy.resource.id label). Services only. */
  serviceResourceId: resourceIdField.nullable(),
  /** Swarm service name — the part before the .slot.taskId suffix. */
  serviceName: z.string().nullable(),
  /** Replica slot ("1", "2", …) parsed out of the swarm task name. */
  replicaSlot: z.string().nullable(),
});

export const terminalDatabaseSchema = z.object({
  resourceId: resourceIdField,
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
