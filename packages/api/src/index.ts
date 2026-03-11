import { implement, ORPCError } from "@orpc/server";
import type { auth } from "@otterdeploy/auth";
import type { db } from "@otterdeploy/db";
import { contract } from "./contract";

export interface Context {
  db: typeof db;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
}

const pub = implement(contract).$context<Context>();

export const publicProcedure = pub;

const requireAuth = pub.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

export { router, type AppRouter } from "./routers";
export { contract } from "./contract";
