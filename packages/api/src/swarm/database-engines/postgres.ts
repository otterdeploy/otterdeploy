import { DATABASE_ENGINES, databaseDataMount } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.postgres;

export const postgresAdapter: DatabaseEngineAdapter = {
  engine: "postgres",
  nameShort: "pg",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  mountTarget: meta.dataDir,
  // Version-aware (postgres 18+ mounts the parent dir): the rule lives with
  // the catalog so the create wizard previews the same path this mounts.
  resolveMount: (image) => ({ target: databaseDataMount("postgres", image) }),
  reservedEnvKeys: new Set(["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]),
  buildEnv: ({ username, password, databaseName }) => [
    `POSTGRES_DB=${databaseName}`,
    `POSTGRES_USER=${username}`,
    `POSTGRES_PASSWORD=${password}`,
  ],
  buildHealthcheck: ({ username, databaseName }) => `pg_isready -U ${username} -d ${databaseName}`,
  buildConnectionString: ({
    username,
    password,
    host,
    port,
    databaseName,
    sslmode,
    sslnegotiation,
  }) => {
    const params: string[] = [];
    if (sslmode) params.push(`sslmode=${sslmode}`);
    if (sslnegotiation) params.push(`sslnegotiation=${sslnegotiation}`);
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${username}:${password}@${hostPort}/${databaseName}${query}`;
  },
  readyPattern: /ready to accept connections/i,
};
