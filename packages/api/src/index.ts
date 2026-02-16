import { ORPCError, os } from "@orpc/server";
import { db, eq, and } from "@otterstack/db";
import { member } from "@otterstack/db/schema/auth";

import type { Context } from "./context";
import { hasMinRole, type OrgRole } from "./utils/helpers";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const authedProcedure = publicProcedure.use(async ({ context, next }) => {
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

export const orgProcedure = authedProcedure.use(async ({ context, next }) => {
  const organizationId = context.organizationId;
  if (!organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "x-organization-id header is required",
    });
  }

  const membership = await db.query.member.findFirst({
    where: and(eq(member.userId, context.userId), eq(member.organizationId, organizationId)),
  });

  if (!membership) {
    throw new ORPCError("FORBIDDEN", {
      message: "Not a member of this organization",
    });
  }

  return next({
    context: {
      ...context,
      organizationId,
      membership: {
        id: membership.id,
        role: membership.role as OrgRole,
        organizationId: membership.organizationId,
      },
    },
  });
});

export const orgMemberProcedure = orgProcedure.use(async ({ context, next }) => {
  if (!hasMinRole(context.membership.role, "member")) {
    throw new ORPCError("FORBIDDEN", { message: "Requires member role or higher" });
  }
  return next({ context });
});

export const orgAdminProcedure = orgProcedure.use(async ({ context, next }) => {
  if (!hasMinRole(context.membership.role, "admin")) {
    throw new ORPCError("FORBIDDEN", { message: "Requires admin role or higher" });
  }
  return next({ context });
});

export const orgOwnerProcedure = orgProcedure.use(async ({ context, next }) => {
  if (!hasMinRole(context.membership.role, "owner")) {
    throw new ORPCError("FORBIDDEN", { message: "Requires owner role" });
  }
  return next({ context });
});

// Re-export for backward compat during migration
export const protectedProcedure = authedProcedure;
export const organizationProcedure = orgProcedure;
