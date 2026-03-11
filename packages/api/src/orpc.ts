import { implement, ORPCError } from "@orpc/server";
import { contract } from "./contract";
import type { Context } from "./context";

const pub = implement(contract).$context<Context>();

export const publicProcedure = pub;

export const protectedProcedure = pub.use(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});
