import { publicProcedure } from "../index";

export const health = publicProcedure.health.handler(async () => {
  return {
    status: "ok" as const,
    timestamp: Date.now(),
  };
});

export const router = publicProcedure.router({
  health,
});

export type AppRouter = typeof router;
