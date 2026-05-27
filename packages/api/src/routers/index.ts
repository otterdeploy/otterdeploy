import { type RouterClient } from "@orpc/server";

import { dockerRouter } from "./docker";
import { envRouter } from "./env";
import { gitRouter } from "./git";
import { organizationRouter } from "./organization";
import { projectRouter } from "./project";
import { serverRouter } from "./server";
import { serviceRouter } from "./service";
import { terminalRouter } from "./terminal";

export const appRouter = {
  docker: dockerRouter,
  env: envRouter,
  git: gitRouter,
  organization: organizationRouter,
  project: projectRouter,
  server: serverRouter,
  service: serviceRouter,
  terminal: terminalRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
