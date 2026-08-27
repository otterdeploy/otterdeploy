/**
 * Shared-database-server schemas: which servers can take another database, and
 * what already lives on each one.
 *
 * This is the read the create flow is built around. The question an operator
 * actually has at that moment is not "does a server exist" but "is there room
 * on it" — so every row carries the live connection budget and the tenants
 * already sharing it, and says plainly when it could not be measured.
 */
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const resourceIdField = zId(ID_PREFIX.resource);

export const hostListInput = z.object({
  /** Only servers running this engine can take the database: the wire
   *  protocol and the connection string are per-engine. */
  engine: z.enum(["postgres", "mariadb", "mongodb"]),
  /** Restrict to one project. Omitted → every eligible server in the org,
   *  because sharing across projects is the whole point for small services. */
  projectId: zId(ID_PREFIX.project).optional(),
});

const hostTenantSchema = z.object({
  resourceId: resourceIdField,
  name: z.string(),
  projectId: zId(ID_PREFIX.project),
  databaseName: z.string(),
  connectionLimit: z.number().int().nullable(),
});

export const hostSchema = z.object({
  resourceId: resourceIdField,
  name: z.string(),
  projectId: zId(ID_PREFIX.project),
  projectName: z.string(),
  engine: z.enum(["postgres", "mariadb", "mongodb"]),
  internalHostname: z.string(),
  internalPort: z.number().int().positive(),
  /** Whether the server's container is up right now. A stopped server can't
   *  be carved into, and the create refuses rather than queueing. */
  running: z.boolean(),
  /** Live connection budget, or null when the server couldn't be probed.
   *  Null means unknown, never zero: a card that renders "0 of 0 used" for an
   *  unreachable server is worse than one that says it doesn't know. */
  connections: z.object({ used: z.number().int(), max: z.number().int() }).nullable(),
  tenants: z.array(hostTenantSchema),
});

export const hostListResultSchema = z.object({ hosts: z.array(hostSchema) });
