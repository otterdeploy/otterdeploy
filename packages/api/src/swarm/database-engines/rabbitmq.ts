import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";

import type { DatabaseEngineAdapter } from "./index";

const meta = DATABASE_ENGINES.rabbitmq;

export const rabbitmqAdapter: DatabaseEngineAdapter = {
  engine: "rabbitmq",
  nameShort: "rmq",
  defaultImage: `${meta.dockerImage}:${meta.defaultTag}`,
  port: meta.defaultPort,
  mountTarget: "/var/lib/rabbitmq",
  reservedEnvKeys: new Set([
    "RABBITMQ_DEFAULT_USER",
    "RABBITMQ_DEFAULT_PASS",
    "RABBITMQ_DEFAULT_VHOST",
  ]),
  buildEnv: ({ username, password }) => [
    `RABBITMQ_DEFAULT_USER=${username}`,
    `RABBITMQ_DEFAULT_PASS=${password}`,
  ],
  // `rabbitmq-diagnostics` is part of the image; `ping` exits 0 when the node
  // is up. No HTTP tooling needed.
  buildHealthcheck: () => "rabbitmq-diagnostics -q ping",
  // No "database" — the default vhost is "/". Connection string carries the
  // broker creds; the consumer picks a vhost.
  buildConnectionString: ({ username, password, host, port }) => {
    const hostPort = port == null ? host : `${host}:${port}`;
    return `${meta.scheme}://${username}:${password}@${hostPort}/`;
  },
  // RabbitMQ logs "Server startup complete" once the broker is accepting
  // connections.
  readyPattern: /Server startup complete|started TCP listener/i,
};
