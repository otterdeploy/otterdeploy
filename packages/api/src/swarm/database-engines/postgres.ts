import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.postgres;

export const postgresAdapter: DatabaseEngineAdapter = {
  engine: "postgres",
  nameShort: "pg",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  // Pre-18 convention: the volume mounts directly at .../data.
  mountTarget: "/var/lib/postgresql/data",
  // postgres:18 switched its image to a pg_ctlcluster-style layout: PGDATA
  // now lives at a major-version-specific subdir (e.g.
  // /var/lib/postgresql/18/docker) that the entrypoint creates and owns
  // itself. Mounting our volume straight at .../data (the pre-18
  // convention) makes the entrypoint see "data in .../data" that isn't the
  // configured PGDATA and refuse to boot ("unused mount/volume" fatal).
  // Fix: mount the *parent* dir for 18+ so the image manages its own
  // versioned subdir underneath — matches upstream's documented migration
  // path. 17 and earlier keep the original mountTarget untouched.
  resolveMount: (image) => {
    const tag = image.split(":").pop() ?? "";
    const major = /^(\d+)/.exec(tag)?.[1];
    if (major != null && Number(major) >= 18) {
      return { target: "/var/lib/postgresql" };
    }
    return { target: "/var/lib/postgresql/data" };
  },
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
