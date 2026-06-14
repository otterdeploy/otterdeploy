import { type RouterClient } from "@orpc/server";

import { apiKeysRouter } from "./apiKeys";
import { auditRouter } from "./audit";
import { backupsRouter } from "./backups";
import { databaseRouter } from "./database";
import { dockerRouter } from "./docker";
import { edgeLogsRouter } from "./edge-logs";
import { envRouter } from "./env";
import { firewallRouter } from "./firewall";
import { gitRouter } from "./git";
import { metricsRouter } from "./metrics";
import { notificationsRouter } from "./notifications";
import { organizationRouter } from "./organization";
import { projectRouter } from "./project";
import { registryRouter } from "./registry";
import { serverRouter } from "./server";
import { serviceRouter } from "./service";
import { terminalRouter } from "./terminal";

export const appRouter = {
  apiKeys: apiKeysRouter,
  audit: auditRouter,
  backups: backupsRouter,
  database: databaseRouter,
  docker: dockerRouter,
  edgeLogs: edgeLogsRouter,
  env: envRouter,
  firewall: firewallRouter,
  git: gitRouter,
  metrics: metricsRouter,
  notifications: notificationsRouter,
  organization: organizationRouter,
  project: projectRouter,
  registry: registryRouter,
  server: serverRouter,
  service: serviceRouter,
  terminal: terminalRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
