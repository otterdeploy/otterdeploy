import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const protectedProcedure = publicProcedure.use(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  const userId = context.session.user.id;
  if (!userId) {
    throw new ORPCError("BAD_REQUEST", { message: "No user context" });
  }

  return next({
    context: {
      session: context.session,
      userId,
      organizationId: context.organizationId ?? null,
      headers: context.headers,
    },
  });
});

export const adminProcedure = protectedProcedure.use(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("BAD_REQUEST", { message: "No user context" });
  }

  const role = context.session?.user?.role;
  if (!role || !role.split(",").includes("admin")) {
    throw new ORPCError("FORBIDDEN");
  }
  return next({ context });
});

export const organizationProcedure = protectedProcedure.use(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (context.organizationId === null) {
    throw new ORPCError("BAD_REQUEST", {
      message: "No organization context",
    });
  }

  const organizationId = context.organizationId;
  return next({ context: { ...context, organizationId } });
});
