import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.minio;

export const minioAdapter: DatabaseEngineAdapter = {
  engine: "minio",
  nameShort: "minio",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  mountTarget: "/data",
  reservedEnvKeys: new Set(["MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD"]),
  buildEnv: ({ username, password }) => [
    `MINIO_ROOT_USER=${username}`,
    `MINIO_ROOT_PASSWORD=${password}`,
  ],
  // The image's entrypoint needs an explicit `server <dir>`; the console binds
  // a second port we don't expose yet, but pinning it keeps the bind stable.
  buildCommand: () => ["server", "/data", "--console-address", ":9001"],
  // ⚠️ MinIO images may not ship `curl`/`wget`; this healthcheck is best-effort
  // and only affects the reported health (the create flow waits on task=running,
  // not health). Verify against a live container; swap for `mc ready` if needed.
  buildHealthcheck: () =>
    "curl -f http://localhost:9000/minio/health/live || exit 1",
  // S3 endpoint. The access key / secret key are the generated user/password,
  // shown separately — they aren't carried in the URL the way DB creds are.
  buildConnectionString: ({ host, port }) => {
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${hostPort}`;
  },
  // MinIO logs its API endpoint line once it's serving.
  readyPattern: /MinIO Object Storage Server|API:\s*http|Status:\s*\d+ Online/i,
};
