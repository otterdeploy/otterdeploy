import { type RouterClient } from "@orpc/server";

import { envRouter } from "./env";

export const appRouter = {
  env: envRouter,
  project: {},
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
