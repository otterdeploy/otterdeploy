import { DATABASE_ENGINES } from "@otterstack/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.postgres;

export const postgresAdapter: DatabaseEngineAdapter = {
  engine: "postgres",
  nameShort: "pg",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  // We pin v17 — postgres 18+ refuses our /var/lib/postgresql/data mount
  // (image manages its own version subdir). See constants.ts comment.
  mountTarget: "/var/lib/postgresql/data",
  reservedEnvKeys: new Set([
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
  ]),
  buildEnv: ({ username, password, databaseName }) => [
    `POSTGRES_DB=${databaseName}`,
    `POSTGRES_USER=${username}`,
    `POSTGRES_PASSWORD=${password}`,
  ],
  buildHealthcheck: ({ username, databaseName }) =>
    `pg_isready -U ${username} -d ${databaseName}`,
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
    return `${meta.scheme}://${username}:${password}@${host}:${port}/${databaseName}${query}`;
  },
  readyPattern: /ready to accept connections/i,
};
