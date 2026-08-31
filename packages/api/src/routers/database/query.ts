import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";
/**
 * Data-viewer query engine. Resolves a database resource to its running
 * container and runs SQL there via psql in a read-only session (PGOPTIONS sets
 * default_transaction_read_only=on, so writes error at the server). Output is
 * parsed from psql's `--csv`.
 *
 * THIS IS NO LONGER THE DATA VIEWER'S PATH. Relational browsing and the SQL
 * runner go through the wire driver in `packages/api/src/data`, which returns
 * typed values instead of CSV text. What is left here serves the engines that
 * have no wire driver yet — Redis, MongoDB, MariaDB's own handlers — plus the
 * catalog's stat probes, all of which still shell into the container.
 *
 * The write path and the row-mutation SQL builders are gone: writes are built
 * by `@otterdeploy/data-engine`'s `buildMutation` and run in a transaction.
 */
import type { OrganizationId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { and, eq } from "drizzle-orm";

import { execCapture, findResourceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";

export interface DbConnInfo {
  engine: DatabaseEngine;
  username: string;
  password: string;
  databaseName: string;
  projectSlug: string;
  resourceName: string;
  /** Used to find the running container by its `otterdeploy.resource.id` label
   *  (runtime-agnostic, see findResourceContainerId). */
  resourceId: ResourceId;
  /** `database_resource.service_name`, when the row carries one. The container
   *  is located by LABEL here, not by name, so this only reaches error
   *  messages — but a message naming a container that does not exist is its
   *  own small lie once names are environment-scoped (od-jwx). */
  serviceName: string | null;
}

export async function getDatabaseConnInfo(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
}): Promise<DbConnInfo | null> {
  const [row] = await db
    .select({
      engine: databaseResource.engine,
      username: databaseResource.username,
      password: databaseResource.password,
      databaseName: databaseResource.databaseName,
      projectSlug: project.slug,
      resourceName: resource.name,
      resourceId: resource.id,
      serviceName: databaseResource.serviceName,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(databaseResource.resourceId, input.resourceId),
        eq(project.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface QueryGrid {
  columns: string[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  truncated: boolean;
  /** Wall-clock time spent running the statement in the container, ms. */
  durationMs: number;
}

/** Run read-only SQL via psql --csv and parse the grid. Throws on query error. */
export class UnsupportedEngineError extends Error {
  constructor(public engine: string) {
    super(`engine ${engine} is not supported`);
    this.name = "UnsupportedEngineError";
  }
}

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

export async function runReadOnlyQuery(
  conn: DbConnInfo,
  sql: string,
  limit: number,
): Promise<QueryGrid> {
  return runQuery(conn, sql, limit, { readOnly: true });
}

async function runQuery(
  conn: DbConnInfo,
  sql: string,
  limit: number,
  opts: { readOnly: boolean },
): Promise<QueryGrid> {
  if (conn.engine !== "postgres") {
    throw new UnsupportedEngineError(conn.engine);
  }
  const docker = Docker.fromEnv();
  try {
    const serviceName = buildContainerName({
      engine: conn.engine,
      projectSlug: conn.projectSlug,
      resourceName: conn.resourceName,
      stored: conn.serviceName,
    });
    const containerId = await findResourceContainerId(docker, conn.resourceId);
    if (!containerId) {
      throw new QueryError(`database container for ${serviceName} is not running`);
    }

    const startedAt = performance.now();
    const result = await execCapture(
      docker,
      containerId,
      [
        "psql",
        "-U",
        conn.username,
        "-d",
        conn.databaseName,
        "--csv",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      {
        env: [
          `PGPASSWORD=${conn.password}`,
          // Read path: the read-only guard makes any write error at the server,
          // no matter what SQL arrives. Write path drops it (default read-write).
          ...(opts.readOnly ? ["PGOPTIONS=-c default_transaction_read_only=on"] : []),
        ],
        allowNonZero: true,
      },
    );

    if (result.exitCode !== 0) {
      throw new QueryError(result.stderr.trim() || "query failed");
    }

    const durationMs = Math.round(performance.now() - startedAt);

    const parsed = parseCsv(result.stdout);
    // Header row is always present + non-null; coerce to string[] for the
    // contract (cell values stay nullable to carry SQL NULL).
    const columns = (parsed.shift() ?? []).map((c) => c ?? "");
    const truncated = parsed.length > limit;
    const rows = parsed.slice(0, limit);
    return { columns, rows, rowCount: parsed.length, truncated, durationMs };
  } finally {
    docker.destroy();
  }
}

/**
 * Minimal RFC-4180 CSV parser (psql --csv output). Handles quoted fields,
 * embedded commas/newlines, and doubled quotes. Empty unquoted field → null,
 * empty quoted field ("") → "" (psql distinguishes NULL from empty string).
 */
function parseCsv(input: string): Array<Array<string | null>> {
  const rows: Array<Array<string | null>> = [];
  let row: Array<string | null> = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  let i = 0;

  const pushField = () => {
    row.push(!wasQuoted && field === "" ? null : field);
    field = "";
    wasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      wasQuoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field/row if the input didn't end with a newline.
  if (field !== "" || wasQuoted || row.length > 0) pushRow();
  return rows;
}
