import { publicProcedure } from "../index";

export const health = publicProcedure.handler(async () => {
  return {
    status: "ok" as const,
    timestamp: Date.now(),
  };
});

export const router = {
  health,
};

export type AppRouter = typeof router;
