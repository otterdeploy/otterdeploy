import { publicProcedure } from "../orpc";

export const health = publicProcedure.health.handler(async () => {
  return {
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  };
});

export const router = publicProcedure.router({
  health,
});

export type AppRouter = typeof router;
