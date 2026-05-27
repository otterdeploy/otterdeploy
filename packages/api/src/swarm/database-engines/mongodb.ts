import { DATABASE_ENGINES } from "@otterstack/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.mongodb;

export const mongodbAdapter: DatabaseEngineAdapter = {
  engine: "mongodb",
  nameShort: "mongo",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  mountTarget: "/data/db",
  reservedEnvKeys: new Set([
    "MONGO_INITDB_ROOT_USERNAME",
    "MONGO_INITDB_ROOT_PASSWORD",
    "MONGO_INITDB_DATABASE",
  ]),
  buildEnv: ({ username, password, databaseName }) => [
    `MONGO_INITDB_ROOT_USERNAME=${username}`,
    `MONGO_INITDB_ROOT_PASSWORD=${password}`,
    `MONGO_INITDB_DATABASE=${databaseName}`,
  ],
  buildHealthcheck: () =>
    // `mongosh` ships in mongo:6+. The `--quiet` keeps boot-log spam out
    // when the engine is up; non-zero exit when not reachable yet.
    `mongosh --quiet --eval "db.adminCommand({ ping: 1 }).ok" | grep -q 1`,
  buildConnectionString: ({ username, password, host, port, databaseName }) => {
    // authSource=admin because MONGO_INITDB_ROOT_* creates the root user
    // in the `admin` db regardless of MONGO_INITDB_DATABASE — connecting
    // to the app db with that user requires this override.
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${username}:${password}@${hostPort}/${databaseName}?authSource=admin`;
  },
  // Mongo 6/7 print this once the listener is bound on every host.
  readyPattern: /Waiting for connections/i,
};
