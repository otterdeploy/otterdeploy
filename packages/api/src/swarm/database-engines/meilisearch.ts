import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.meilisearch;

export const meilisearchAdapter: DatabaseEngineAdapter = {
  engine: "meilisearch",
  nameShort: "meili",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  mountTarget: "/meili_data",
  reservedEnvKeys: new Set(["MEILI_MASTER_KEY", "MEILI_ENV", "MEILI_NO_ANALYTICS"]),
  // Meilisearch auths with a single MASTER KEY (no username/database). The
  // generated `password` is that key; `username`/`databaseName` are unused.
  buildEnv: ({ password }) => [
    `MEILI_MASTER_KEY=${password}`,
    "MEILI_ENV=production",
    "MEILI_NO_ANALYTICS=true",
  ],
  // ⚠️ The image may not ship `curl`; best-effort (health is advisory — create
  // waits on task=running). /health needs no auth. Verify against a live image.
  buildHealthcheck: () => "curl -f http://localhost:7700/health || exit 1",
  // HTTP endpoint; the master key (= the generated password) is sent as an
  // Authorization header, not in the URL.
  buildConnectionString: ({ host, port }) => {
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${hostPort}`;
  },
  // Meilisearch logs "Server listening on ..." once ready.
  readyPattern: /Server listening on|Meilisearch is ready/i,
};
