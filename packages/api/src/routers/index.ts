import { type RouterClient } from "@orpc/server";

import { dockerRouter } from "./docker";
import { envRouter } from "./env";
import { projectRouter } from "./project";
import { serviceRouter } from "./service";

export const appRouter = {
  docker: dockerRouter,
  env: envRouter,
  project: projectRouter,
  service: serviceRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
