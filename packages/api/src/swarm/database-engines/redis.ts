import { DATABASE_ENGINES } from "@otterstack/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.redis;

export const redisAdapter: DatabaseEngineAdapter = {
  engine: "redis",
  nameShort: "redis",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  // The redis image defaults to /data for its dump.rdb + appendonly file.
  // Operators can mount additional volumes later for AOF backups, but the
  // canonical persistence target is /data.
  mountTarget: "/data",
  // Redis doesn't take auth via env — it's a CLI flag. Nothing to reserve.
  reservedEnvKeys: new Set(),
  buildEnv: () => [],
  buildCommand: ({ password }) => [
    "redis-server",
    "--requirepass",
    password,
    "--appendonly",
    "yes",
  ],
  // `-a` passes the password; we silence the warning about command-line
  // auth so the healthcheck output stays clean.
  buildHealthcheck: ({ password }) =>
    `redis-cli --no-auth-warning -a ${password} ping | grep -q PONG`,
  buildConnectionString: ({ password, host, port }) => {
    // Redis URLs put the password before the @ with no username — username
    // is optional in redis:// and we don't model one in the spec.
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://:${password}@${hostPort}/0`;
  },
  // The standard ready message in 7.x is "Ready to accept connections tcp".
  readyPattern: /Ready to accept connections/,
};
