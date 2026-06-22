/**
 * MariaDB/MySQL data-viewer engine. Like the Postgres viewer this is relational,
 * but to keep it strictly read-only with no client SQL it's a table BROWSER (not
 * a free-text console): list tables, then page through a table's rows. Every
 * statement is built server-side (information_schema list + `SELECT * FROM
 * <quoted> LIMIT/OFFSET`), so there is no injection surface and nothing can
 * write.
 *
 * Runs inside the database's own task container via the same Docker exec channel
 * the backup engine + redis viewer use, so creds never touch the overlay network
 * (password via `MYSQL_PWD`, off argv). Output is `mysql --batch` (tab-delimited,
 * NULL as `\N`, control chars backslash-escaped) which we parse + unescape.
 */
import { Docker } from "@otterdeploy/docker";

import { execCapture, findServiceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";
import {
  type DbConnInfo,
  QueryError,
  UnsupportedEngineError,
} from "./query";

export interface MariadbTable {
  schema: string;
  name: string;
}

export interface MariadbGrid {
  columns: string[];
  rows: Array<Array<string | null>>;
  /** True when another page exists (we fetched `limit + 1`). */
  hasMore: boolean;
}

/** System schemas hidden from the browser. */
const SYSTEM_SCHEMAS = [
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
];

async function withMysql<T>(
  conn: DbConnInfo,
  fn: (run: (sql: string) => Promise<string>) => Promise<T>,
): Promise<T> {
  if (conn.engine !== "mariadb") throw new UnsupportedEngineError(conn.engine);
  const docker = Docker.fromEnv();
  try {
    const serviceName = buildContainerName({
      engine: conn.engine,
      projectSlug: conn.projectSlug,
      resourceName: conn.resourceName,
    });
    const containerId = await findServiceContainerId(docker, serviceName);
    if (!containerId) {
      throw new QueryError(`mariadb container for ${serviceName} is not running`);
    }
    const run = async (sql: string) => {
      // `mysql` (and the `mariadb` client alias) read the password from
      // MYSQL_PWD, keeping it off argv. `--batch` gives parseable tab-delimited
      // output; `-N` is NOT passed so the header row carries column names.
      const result = await execCapture(
        docker,
        containerId,
        ["mysql", "-u", conn.username, "--batch", "-e", sql],
        { env: [`MYSQL_PWD=${conn.password}`], allowNonZero: true },
      );
      if (result.exitCode !== 0) {
        throw new QueryError(result.stderr.trim() || "mysql command failed");
      }
      return result.stdout;
    };
    return await fn(run);
  } finally {
    docker.destroy();
  }
}

/** Quote a MySQL identifier with backticks (internal backticks doubled). */
function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/** Parse `mysql --batch` output (tab-delimited, escaped) into a grid. */
function parseBatch(out: string): { columns: string[]; rows: string[][] } {
  const lines = out.replace(/\n$/, "").split("\n");
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return { columns: [], rows: [] };
  }
  const split = (line: string) => line.split("\t");
  const columns = split(lines[0] ?? "").map((c) => unescapeCell(c) ?? c);
  const rows = lines.slice(1).map(split);
  return { columns, rows: rows.map((r) => r.map((c) => c)) };
}

/** Unescape one `mysql --batch` field. `\N` (exactly) is SQL NULL; control
 *  chars are backslash-escaped (`\t` `\n` `\0` `\\`). */
function unescapeCell(field: string): string | null {
  if (field === "\\N") return null;
  return field.replace(/\\([tn0\\])/g, (_, c: string) =>
    c === "t" ? "\t" : c === "n" ? "\n" : c === "0" ? "\0" : "\\",
  );
}

/** List user tables (excludes system schemas). */
export async function mariadbTables(conn: DbConnInfo): Promise<MariadbTable[]> {
  return withMysql(conn, async (run) => {
    const notIn = SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(", ");
    const out = await run(
      `SELECT table_schema, table_name FROM information_schema.tables ` +
        `WHERE table_schema NOT IN (${notIn}) AND table_type = 'BASE TABLE' ` +
        `ORDER BY table_schema, table_name`,
    );
    const { rows } = parseBatch(out);
    return rows.map((r) => ({
      schema: unescapeCell(r[0] ?? "") ?? "",
      name: unescapeCell(r[1] ?? "") ?? "",
    }));
  });
}

/** Page through a table's rows (read-only `SELECT *`). */
export async function mariadbBrowse(
  conn: DbConnInfo,
  opts: { schema: string; table: string; limit: number; offset: number },
): Promise<MariadbGrid> {
  return withMysql(conn, async (run) => {
    const target = `${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`;
    // Fetch one extra to detect a next page without a COUNT(*).
    const out = await run(
      `SELECT * FROM ${target} LIMIT ${opts.limit + 1} OFFSET ${opts.offset}`,
    );
    const { columns, rows } = parseBatch(out);
    const hasMore = rows.length > opts.limit;
    return {
      columns,
      rows: rows.slice(0, opts.limit).map((r) => r.map(unescapeCell)),
      hasMore,
    };
  });
}
