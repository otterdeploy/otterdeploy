/**
 * Data viewer oRPC contract (docs/designs/data-viewer.md). A read-first SQL
 * console + grid over a provisioned database resource. v1 is postgres-only and
 * runs every statement in a read-only session (writes error at the server);
 * the write path is gated behind a separate permission for a later phase.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

const tag = "database";
const basePath = "/database";

const resourceIdField = zId(ID_PREFIX.resource);

const notDatabase = {
  NOT_FOUND: { status: 404 as const, message: "Database not found" as const },
  UNSUPPORTED: {
    status: 422 as const,
    message: "Engine not supported by the data viewer yet" as const,
  },
  QUERY_FAILED: {
    status: 422 as const,
    message: "Query failed" as const,
    data: z.object({ reason: z.string() }),
  },
};

export const queryInput = z.object({
  resourceId: resourceIdField,
  sql: z.string().min(1).max(100_000),
  // Hard cap on returned rows (UI grid). The engine still streams the full
  // result from psql, then truncates — fine for a console, not for exports.
  limit: z.number().int().positive().max(5000).default(200),
});

export const queryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  rowCount: z.number(),
  truncated: z.boolean(),
  durationMs: z.number(),
});

export const tablesInput = z.object({ resourceId: resourceIdField });

export const tablesResultSchema = z.object({
  tables: z.array(
    z.object({ schema: z.string(), name: z.string() }),
  ),
});

export const databaseContract = {
  // List user tables in the database (excludes catalog/system schemas).
  tables: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/tables`, tag, method: "GET" })
    .input(tablesInput)
    .output(tablesResultSchema),

  // Run a read-only SQL statement and return the grid.
  query: oc
    .errors(notDatabase)
    .meta({ path: `${basePath}/{resourceId}/query`, tag, method: "POST" })
    .input(queryInput)
    .output(queryResultSchema),
};
