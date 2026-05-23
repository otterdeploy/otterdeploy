import type { Context } from "./context";

import { implement, os as orpc } from "@orpc/server";

import { dockerContract } from "./routers/docker/contract";
import { envContract } from "./routers/env/contract";
import { projectContract } from "./routers/project/contract";
import { serviceContract } from "./routers/service/contract";
import type { Id, ID_PREFIX } from "@otterstack/shared/id";

export const publicProcedure = implement({
  docker: dockerContract,
  env: envContract,
  project: projectContract,
  service: serviceContract,
}).$context<Context>();

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

/**
 * Procedure that requires both authentication AND an active organization.
 * Handlers receive `context.activeOrganizationId` narrowed to `string`.
 */
const orgScopedMiddleware = orpc
  .$context<Context>()
  .errors({
    UNAUTHORIZED: { message: "Unauthorized" },
    NO_ACTIVE_ORGANIZATION: {
      status: 400,
      message: "No active organization. Set one before calling this endpoint.",
    },
  })
  .middleware(async ({ context, next, errors }) => {
    if (!context.session?.user) {
      throw errors.UNAUTHORIZED();
    }
    if (!context.activeOrganizationId) {
      throw errors.NO_ACTIVE_ORGANIZATION();
    }
    return next({
      context: {
        session: context.session,
        activeOrganizationId: context.activeOrganizationId as Id<
          typeof ID_PREFIX.organization
        >,
      },
    });
  });

export const orgScopedProcedure = publicProcedure.use(orgScopedMiddleware);
