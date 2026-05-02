import { type RouterClient } from "@orpc/server";

import { envRouter } from "./env";
import { projectRouter } from "./project";

export const appRouter = {
  env: envRouter,
  project: projectRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
