import { type RouterClient } from "@orpc/server";

import { apiKeysRouter } from "./apiKeys";
import { auditRouter } from "./audit";
import { backupsRouter } from "./backups";
import { certificatesRouter } from "./certificates";
import { composeRouter } from "./compose";
import { databaseRouter } from "./database";
import { deploymentRouter } from "./deployment";
import { dnsRouter } from "./dns";
import { dockerRouter } from "./docker";
import { edgeLogsRouter } from "./edge-logs";
import { envRouter } from "./env";
import { eventsRouter } from "./events";
import { firewallRouter } from "./firewall";
import { gitRouter } from "./git";
import { meshRouter } from "./mesh";
import { metricsRouter } from "./metrics";
import { migrateRouter } from "./migrate";
import { notificationsRouter } from "./notifications";
import { organizationRouter } from "./organization";
import { projectRouter } from "./project";
import { registryRouter } from "./registry";
import { serverRouter } from "./server";
import { serviceRouter } from "./service";
import { sshKeysRouter } from "./sshKeys";
import { ssoRouter } from "./sso";
import { systemRouter } from "./system";
import { terminalRouter } from "./terminal";
import { vaultProviderRouter } from "./vault-provider";
import { volumesRouter } from "./volumes";
import { webhooksRouter } from "./webhooks";

export const appRouter = {
  apiKeys: apiKeysRouter,
  audit: auditRouter,
  backups: backupsRouter,
  certificates: certificatesRouter,
  compose: composeRouter,
  database: databaseRouter,
  deployment: deploymentRouter,
  sso: ssoRouter,
  dns: dnsRouter,
  docker: dockerRouter,
  edgeLogs: edgeLogsRouter,
  env: envRouter,
  events: eventsRouter,
  firewall: firewallRouter,
  git: gitRouter,
  mesh: meshRouter,
  metrics: metricsRouter,
  migrate: migrateRouter,
  notifications: notificationsRouter,
  organization: organizationRouter,
  project: projectRouter,
  registry: registryRouter,
  server: serverRouter,
  service: serviceRouter,
  sshKeys: sshKeysRouter,
  system: systemRouter,
  terminal: terminalRouter,
  vaultProvider: vaultProviderRouter,
  volumes: volumesRouter,
  webhooks: webhooksRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
