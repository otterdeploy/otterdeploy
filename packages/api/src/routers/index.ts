import type { RouterClient } from "@orpc/server";

import { projectRouter } from "./project";
import { environmentRouter } from "./environment";
import { resourceRouter } from "./resource";
import { resourceLinkRouter } from "./resource-link";
import { architectureRouter } from "./architecture";
import { deploymentRouter } from "./deployment";
import { environmentVariableRouter } from "./environment-variable";
import { domainRouter } from "./domain";
import { serverRouter } from "./server";
import { monitoringRouter } from "./monitoring";
import { backupRouter } from "./backup";
import { teamRouter } from "./team";
import { auditRouter } from "./audit";
import { systemRouter } from "./system";

export const appRouter = {
  project: projectRouter,
  environment: environmentRouter,
  resource: resourceRouter,
  resourceLink: resourceLinkRouter,
  architecture: architectureRouter,
  deployment: deploymentRouter,
  environmentVariable: environmentVariableRouter,
  domain: domainRouter,
  server: serverRouter,
  monitoring: monitoringRouter,
  backup: backupRouter,
  team: teamRouter,
  audit: auditRouter,
  system: systemRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
