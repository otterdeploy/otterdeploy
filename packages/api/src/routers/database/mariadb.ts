/**
 * The MariaDB exec channel, kept ONLY for the org catalog's stat probe.
 *
 * This file used to be a whole second data viewer: list `information_schema`,
 * page rows with `SELECT * FROM <quoted> LIMIT/OFFSET`, parse `mysql --batch`
 * tab-delimited output and un-escape `\N` back into NULL. All of that
 * reimplemented what the Postgres viewer already did, in a transport that could
 * not tell NULL from the literal string `\N` without the un-escaping step.
 *
 * MariaDB now goes through the same wire driver and the same workbench as
 * Postgres (`packages/api/src/data`), so the browser half is deleted. What
 * remains is the exec channel itself, because the catalog's per-database stats
 * still shell into the container for every engine and there is no reason to
 * open a pooled connection just to read a size.
 *
 * Runs inside the database's own task container, so credentials never touch the
 * overlay network (password via `MYSQL_PWD`, off argv).
 */
import { Docker } from "@otterdeploy/docker";

import { execCapture, findResourceContainerId } from "../../backups/exec";
import { buildContainerName } from "../project/views";
import { type DbConnInfo, QueryError, UnsupportedEngineError } from "./query";

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

/** List user tables (excludes system schemas). */
