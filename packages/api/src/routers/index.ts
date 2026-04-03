import { ORPCError, type RouterClient } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, publicProcedure } from "../index";

const envs = [
  { id: "1", name: "Development", slug: "dev" },
  { id: "2", name: "Staging", slug: "staging" },
];

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  env: {
    all: publicProcedure

      .handler(({ errors }) => {
        return envs;
      }),
    createEnv: publicProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
        }),
      )
      .meta({
        group: "env",
      })
      .handler(({ input, context, ...r }) => {
        envs.push(input);
        const meta = r.procedure["~orpc"].meta as { group?: string };
        if (meta?.group) {
          context.broadcast(meta.group);
        }
        return input;
      }),
  },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
