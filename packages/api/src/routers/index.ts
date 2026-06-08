import { type RouterClient } from "@orpc/server";

import { auditRouter } from "./audit";
import { backupsRouter } from "./backups";
import { dockerRouter } from "./docker";
import { envRouter } from "./env";
import { gitRouter } from "./git";
import { organizationRouter } from "./organization";
import { projectRouter } from "./project";
import { registryRouter } from "./registry";
import { serverRouter } from "./server";
import { serviceRouter } from "./service";
import { terminalRouter } from "./terminal";

export const appRouter = {
  audit: auditRouter,
  backups: backupsRouter,
  docker: dockerRouter,
  env: envRouter,
  git: gitRouter,
  organization: organizationRouter,
  project: projectRouter,
  registry: registryRouter,
  server: serverRouter,
  service: serviceRouter,
  terminal: terminalRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
