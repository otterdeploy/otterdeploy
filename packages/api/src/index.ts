import { ORPCError, os } from "@orpc/server";
import type { auth } from "@otterdeploy/auth";
import type { db } from "@otterdeploy/db";

export interface Context {
  db: typeof db;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
}

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
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
