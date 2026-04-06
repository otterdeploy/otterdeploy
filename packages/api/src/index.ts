import type { Context } from "./context";

import { implement, os as orpc } from "@orpc/server";

import { envContract } from "./routers/env/contract";

export const publicProcedure = implement({ env: envContract }).$context<Context>();

const authMiddleware = orpc
  .$context<Context>()
  .errors({
    UNAUTHORIZED: {
      message: "Unauthorized",
    },
  })
  .middleware(async ({ context, next, errors }) => {
    if (!context.session?.user) {
      throw errors.UNAUTHORIZED();
    }
    return next({
      context: {
        session: context.session,
      },
    });
  });

export const protectedProcedure = publicProcedure.use(authMiddleware);
