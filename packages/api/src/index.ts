import { ID_PREFIX } from "@otterdeploy/shared/id";
import type { Id } from "@otterdeploy/shared/id";
import type { Context } from "./context";

import { implement, ORPCError, os as orpc } from "@orpc/server";

import { auditContract } from "./routers/audit/contract";
import { backupsContract } from "./routers/backups/contract";
import { dockerContract } from "./routers/docker/contract";
import { envContract } from "./routers/env/contract";
import { gitContract } from "./routers/git/contract";
import { organizationContract } from "./routers/organization/contract";
import { projectContract } from "./routers/project/contract";
import { registryContract } from "./routers/registry/contract";
import { serverContract } from "./routers/server/contract";
import { serviceContract } from "./routers/service/contract";
import { terminalContract } from "./routers/terminal/contract";
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

// Read-ish verbs that aren't worth a persisted audit row on success. We still
// audit every *denial* (even of a read) — a blocked read is exactly what
// auditors want — and every non-read mutation.
const READ_VERB =
  /^(list|get|inspect|stream|search|count|fetch|read|resolve|view|preview|status|events|logs|metrics|stats)/i;
function isReadAction(action: string): boolean {
  return READ_VERB.test(action.split(".").pop() ?? action);
}

const traceProcedure = orpc
  .$context<Context>()
  .middleware(async ({ context, path, next }) => {
    const action = path.join(".");
    const user = context.session?.user;
    const actor = user
      ? { type: "user" as const, id: user.id, email: user.email }
      : { type: "api" as const, id: "anonymous" };
    // Top-level fields keep the console/observability wide event informative.
    context.log.set({
      action,
      actor,
      context: { tenantId: context.activeOrganizationId },
    });
    const start = performance.now();
    try {
      const result = await next();
      context.log.set({ outcome: "success", durationMs: performance.now() - start });
      // Persist mutations; skip read successes. Tenant id rides on the
      // top-level `context.tenantId` set above (the pg drain reads it); request
      // meta (ip/ua/requestId) is filled into `audit.context` by auditEnricher.
      if (!isReadAction(action)) {
        context.log.audit?.({ action, actor, outcome: "success" });
      }
      return result;
    } catch (error) {
      const isOrpc = error instanceof ORPCError;
      const code = isOrpc ? error.code : undefined;
      const reason = error instanceof Error ? error.message : String(error);
      const denied = Boolean(code && DENIED_ORPC_CODES.has(code));
      context.log.set({
        outcome: denied ? "denied" : "failure",
        reason,
        error: isOrpc
          ? { name: error.name, message: error.message, code: error.code }
          : error instanceof Error
            ? { name: error.name, message: error.message }
            : error,
        durationMs: performance.now() - start,
      });
      // Always audit denials; audit failures only for mutating actions.
      if (denied) {
        context.log.audit?.deny(reason, { action, actor });
      } else if (!isReadAction(action)) {
        context.log.audit?.({ action, actor, outcome: "failure", reason });
      }
      throw error;
    }
  });

export const publicProcedure = implement({
  audit: auditContract,
  backups: backupsContract,
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
