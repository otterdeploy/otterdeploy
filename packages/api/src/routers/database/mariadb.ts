/**
 * MariaDB/MySQL data-viewer engine. Like the Postgres viewer this is relational,
 * but to keep it strictly read-only with no client SQL it's a table BROWSER (not
 * a free-text console): list tables, then page through a table's rows. Every
 * statement is built server-side (see mariadb-shape.ts), so there is no
 * injection surface and nothing can write.
 *
 * Runs inside the database's own task container via the same Docker exec channel
 * the backup engine + redis viewer use, so creds never touch the overlay network
 * (password via `MYSQL_PWD`, off argv). Output is `--batch` (tab-delimited,
 * NULL as `\N`, control chars backslash-escaped) which we parse + unescape.
 *
 * The client binary is PROBED, not assumed: the MariaDB Docker Official Image
 * dropped the `mysql*` symlinks at 11.0 in favour of `mariadb*`, and we default
 * to `mariadb:12` — so the old hardcoded `mysql` exec never found an executable
 * and the whole Data tab surfaced as "Couldn't list tables". See
 * CLIENT_CANDIDATES for why `mysql` is still a fallback.
 */
import { Docker } from "@otterdeploy/docker";

import type { MariadbGrid, MariadbTable } from "./mariadb-shape";

import { execCapture, findResourceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";
import {
  CLIENT_CANDIDATES,
  CLIENT_PROBE_SCRIPT,
  buildBrowseSql,
  buildPrimaryKeySql,
  buildTablesSql,
  pickClientPath,
  shapeGrid,
  shapePrimaryKey,
  shapeTables,
} from "./mariadb-shape";
import { type DbConnInfo, QueryError, UnsupportedEngineError } from "./query";

export type { MariadbGrid, MariadbTable } from "./mariadb-shape";

/** Locate the client inside the container. One extra exec per `withMysql`
 *  block, amortized across every statement that block runs. */
async function resolveClientPath(docker: Docker, containerId: string): Promise<string> {
  const probe = await execCapture(docker, containerId, ["sh", "-c", CLIENT_PROBE_SCRIPT], {
    allowNonZero: true,
  });
  const path = pickClientPath(probe.stdout);
  if (!path) {
    throw new QueryError(
      `no MariaDB/MySQL client in the container (looked for ${CLIENT_CANDIDATES.join(", ")})`,
    );
  }
  return path;
}

// Exported so the org-catalog stats collector can issue its own read-only
// statements through the same exec channel (password via MYSQL_PWD, off argv).
export async function withMysql<T>(
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
    const containerId = await findResourceContainerId(docker, conn.resourceId);
    if (!containerId) {
      throw new QueryError(`mariadb container for ${serviceName} is not running`);
    }
    const client = await resolveClientPath(docker, containerId);
    const run = async (sql: string) => {
      // Both clients read the password from MYSQL_PWD, keeping it off argv
      // (MariaDB kept the MySQL-named env var when it renamed the binaries).
      // `--batch` gives parseable tab-delimited output; `-N` is NOT passed so
      // the header row carries column names.
      const result = await execCapture(
        docker,
        containerId,
        [client, "-u", conn.username, "--batch", "-e", sql],
        { env: [`MYSQL_PWD=${conn.password}`], allowNonZero: true },
      );
      if (result.exitCode !== 0) {
        throw new QueryError(result.stderr.trim() || `${client} command failed`);
      }
      return result.stdout;
    };
    return await fn(run);
  } finally {
    docker.destroy();
  }
}

/** List user tables with the engine's row estimate (excludes system schemas). */
export async function mariadbTables(conn: DbConnInfo): Promise<MariadbTable[]> {
  return withMysql(conn, async (run) => shapeTables(await run(buildTablesSql())));
}

/** Page through a table's rows (read-only `SELECT *`, primary-key ordered). */
export async function mariadbBrowse(
  conn: DbConnInfo,
  opts: { schema: string; table: string; limit: number; offset: number },
): Promise<MariadbGrid> {
  return withMysql(conn, async (run) => {
    // Resolve the primary key first so paging is stable — see buildBrowseSql.
    const pk = shapePrimaryKey(await run(buildPrimaryKeySql(opts.schema, opts.table)));
    const out = await run(buildBrowseSql({ ...opts, pk }));
    return shapeGrid(out, opts.limit);
  });
}
