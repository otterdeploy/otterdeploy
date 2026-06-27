import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.clickhouse;

export const clickhouseAdapter: DatabaseEngineAdapter = {
  engine: "clickhouse",
  nameShort: "ch",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  mountTarget: "/var/lib/clickhouse",
  reservedEnvKeys: new Set(["CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD", "CLICKHOUSE_DB"]),
  buildEnv: ({ username, password, databaseName }) => [
    `CLICKHOUSE_USER=${username}`,
    `CLICKHOUSE_PASSWORD=${password}`,
    `CLICKHOUSE_DB=${databaseName}`,
    // Let the bootstrap user create databases / users (otherwise a fresh
    // non-default user can't run DDL).
    "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1",
  ],
  // `clickhouse-client` ships in the server image, so this needs no extra
  // tooling. SELECT 1 against the native protocol confirms it's serving.
  buildHealthcheck: ({ username, password }) =>
    `clickhouse-client --user ${username} --password ${password} --query 'SELECT 1'`,
  buildConnectionString: ({ username, password, host, port, databaseName }) => {
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${username}:${password}@${hostPort}/${databaseName}`;
  },
  // ClickHouse logs "Application: Ready for connections." once it's serving.
  readyPattern: /Ready for connections|Application: Listening for connections/i,
};
