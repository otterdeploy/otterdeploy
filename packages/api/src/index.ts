import type { Context } from "./context";

import { implement, ORPCError, os as orpc } from "@orpc/server";

import { dockerContract } from "./routers/docker/contract";
import { envContract } from "./routers/env/contract";
import { gitContract } from "./routers/git/contract";
import { organizationContract } from "./routers/organization/contract";
import { projectContract } from "./routers/project/contract";
import { registryContract } from "./routers/registry/contract";
import { serverContract } from "./routers/server/contract";
import { serviceContract } from "./routers/service/contract";
import { terminalContract } from "./routers/terminal/contract";
import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

// Per-procedure compliance trail, shaped to the evlog audit schema
// (https://www.evlog.dev/use-cases/audit/schema). Stamps the request-scoped
// wide event with action, actor, outcome, duration, and reason so every RPC
// call lands in the drain as a single, fully-attributed audit record.
// Handlers add `target` (and any domain-specific fields) via
// context.log.set(...).
const DENIED_ORPC_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NO_ACTIVE_ORGANIZATION",
]);

const traceProcedure = orpc
  .$context<Context>()
  .middleware(async ({ context, path, next }) => {
    const user = context.session?.user;
    context.log.set({
      action: path.join("."),
      actor: user
        ? { type: "user" as const, id: user.id, email: user.email }
        : { type: "api" as const, id: "anonymous" },
      context: { tenantId: context.activeOrganizationId },
    });
    const start = performance.now();
    try {
      const result = await next();
      context.log.set({ outcome: "success", durationMs: performance.now() - start });
      return result;
    } catch (error) {
      const isOrpc = error instanceof ORPCError;
      const code = isOrpc ? error.code : undefined;
      const reason = error instanceof Error ? error.message : String(error);
      context.log.set({
        outcome: code && DENIED_ORPC_CODES.has(code) ? "denied" : "failure",
        reason,
        error: isOrpc
          ? { name: error.name, message: error.message, code: error.code }
          : error instanceof Error
            ? { name: error.name, message: error.message }
            : error,
        durationMs: performance.now() - start,
      });
      throw error;
    }
  });

export const publicProcedure = implement({
  docker: dockerContract,
  env: envContract,
  git: gitContract,
  organization: organizationContract,
  project: projectContract,
  registry: registryContract,
  server: serverContract,
  service: serviceContract,
  terminal: terminalContract,
})
  .$context<Context>()
  .use(traceProcedure);

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
