import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.mariadb;

export const mariadbAdapter: DatabaseEngineAdapter = {
  engine: "mariadb",
  nameShort: "mariadb",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  // MariaDB writes its datadir to /var/lib/mysql (same path the MySQL image
  // uses — MariaDB ships compatible aliasing).
  mountTarget: "/var/lib/mysql",
  reservedEnvKeys: new Set([
    "MARIADB_ROOT_PASSWORD",
    "MARIADB_DATABASE",
    "MARIADB_USER",
    "MARIADB_PASSWORD",
    // The mariadb image also reads the MYSQL_* aliases as a back-compat
    // shim; reserving them too keeps user-set values from racing with our
    // identity envs.
    "MYSQL_ROOT_PASSWORD",
    "MYSQL_DATABASE",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
  ]),
  buildEnv: ({ username, password, databaseName }) => [
    // Use MARIADB_* for forward-compat — image v11+ prefers them. Setting
    // root password to the user password keeps things simple; if operators
    // need separation they can override via extraEnv (we filter root pwd
    // out of reservedEnvKeys above so the override sticks).
    `MARIADB_ROOT_PASSWORD=${password}`,
    `MARIADB_DATABASE=${databaseName}`,
    `MARIADB_USER=${username}`,
    `MARIADB_PASSWORD=${password}`,
  ],
  // `healthcheck.sh --connect --innodb_initialized` is the official probe
  // shipped with the mariadb image (mariadbd-launch ensures it's on PATH).
  buildHealthcheck: () =>
    `healthcheck.sh --su-mysql --connect --innodb_initialized`,
  buildConnectionString: ({ username, password, host, port, databaseName }) => {
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${username}:${password}@${hostPort}/${databaseName}`;
  },
  readyPattern: /ready for connections/i,
};
