import { auth } from "@otterdeploy/auth";
import type { PermissionCheck } from "@otterdeploy/auth/permissions";
import { ID_PREFIX } from "@otterdeploy/shared/id";
import type { Id } from "@otterdeploy/shared/id";
import type { Context } from "./context";
import {
  authorizeKeyScope,
  authorizeRoleScope,
  isReadAction as isReadActionPath,
  requireProjectScope,
} from "./authz/api-key-scope";

import { implement, ORPCError, os as orpc } from "@orpc/server";

import { apiKeysContract } from "./routers/apiKeys/contract";
import { auditContract } from "./routers/audit/contract";
import { backupsContract } from "./routers/backups/contract";
import { databaseContract } from "./routers/database/contract";
import { dockerContract } from "./routers/docker/contract";
import { edgeLogsContract } from "./routers/edge-logs/contract";
import { envContract } from "./routers/env/contract";
import { firewallContract } from "./routers/firewall/contract";
import { gitContract } from "./routers/git/contract";
import { metricsContract } from "./routers/metrics/contract";
import { notificationsContract } from "./routers/notifications/contract";
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
      : context.apiKey
        ? { type: "api" as const, id: context.apiKey.id }
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
  apiKeys: apiKeysContract,
  audit: auditContract,
  backups: backupsContract,
  database: databaseContract,
  docker: dockerContract,
  edgeLogs: edgeLogsContract,
  env: envContract,
  firewall: firewallContract,
  git: gitContract,
  metrics: metricsContract,
  notifications: notificationsContract,
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
    // A session/cookie/CLI-bearer user OR a verified API-key actor counts as
    // authenticated. Session-identity handlers still read `context.session`
    // directly (null for key actors) — guard there if they need a real user.
    if (!context.session?.user && !context.apiKey) {
      throw errors.UNAUTHORIZED();
    }
    return next({
      context: {
        session: context.session,
        apiKey: context.apiKey,
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
    // Session/cookie/CLI-bearer user OR a verified API-key actor. For a key
    // actor `activeOrganizationId` was already populated from the key's owning
    // org in createContext, so the NO_ACTIVE_ORGANIZATION gate still holds.
    if (!context.session?.user && !context.apiKey) {
      throw errors.UNAUTHORIZED();
    }
    if (!context.activeOrganizationId) {
      throw errors.NO_ACTIVE_ORGANIZATION();
    }
    return next({
      context: {
        session: context.session,
        apiKey: context.apiKey,
        activeOrganizationId: context.activeOrganizationId as Id<
          typeof ID_PREFIX.organization
        >,
      },
    });
  });

export const orgScopedProcedure = publicProcedure.use(orgScopedMiddleware);

/**
 * Build an org-scoped procedure that additionally requires a specific RBAC
 * permission. Role resolution + the permission check are delegated to
 * better-auth's `auth.api.hasPermission` (statements/roles defined in
 * `@otterdeploy/auth/permissions`) — no hand-rolled member-table lookups.
 *
 * Usage:
 *   requirePermission({ backup: ["run"] }).backups.run.handler(...)
 *   requirePermission({ member: ["create"] }).organization.invite.handler(...)
 */
export function requirePermission(permission: PermissionCheck) {
  const permissionMiddleware = orpc
    .$context<Context>()
    .errors({
      FORBIDDEN: {
        status: 403,
        message: "You don't have permission to perform this action.",
      },
    })
    .middleware(async ({ context, path, next, errors }) => {
      // API-key actor: session-bound `hasPermission` can't see the key, so we
      // enforce scope ourselves. Effective permission = min(key scope, member
      // role) — DECISION A in authz/api-key-scope.ts. A read-only key
      // additionally blocks any non-read action.
      if (context.apiKey) {
        if (
          context.apiKey.accessLevel === "read" &&
          !isReadActionPath(path.join("."))
        ) {
          throw errors.FORBIDDEN({ message: "This API key is read-only." });
        }
        const ok =
          authorizeKeyScope(context.apiKey.permissions, permission) &&
          authorizeRoleScope(permission);
        if (!ok) {
          throw errors.FORBIDDEN();
        }
        return next();
      }

      // Session actor (cookie / CLI device-grant bearer) — unchanged path:
      // delegate role resolution to better-auth's session-bound check.
      const { success } = await auth.api.hasPermission({
        headers: context.headers,
        body: {
          permissions: permission as Record<string, string[]>,
        },
      });
      if (!success) {
        throw errors.FORBIDDEN();
      }
      return next();
    });

  return orgScopedProcedure.use(permissionMiddleware);
}

/**
 * Org-scoped procedure that additionally constrains an API-key actor to the
 * project(s) its scope allows. The `projectId` is read from validated input
 * (handlers vary in whether it's required, so the middleware no-ops when it's
 * absent). Session/cookie actors are never project-restricted — only keys
 * minted with `projectScope: "selected"` are gated.
 *
 * Defined for incremental adoption: wire it onto high-value mutating
 * project-scoped routers as `projectScopedProcedure.<router>.<proc>.handler(...)`
 * in place of `orgScopedProcedure`. Not mass-applied here — the core key-scope +
 * role intersection is enforced on every `requirePermission` procedure already.
 */
const projectScopeMiddleware = orpc
  .$context<Context>()
  .errors({
    FORBIDDEN: {
      status: 403,
      message: "This API key is not scoped to that project.",
    },
  })
  .middleware(async ({ context, next, errors }, input) => {
    if (context.apiKey) {
      const projectId = (input as { projectId?: unknown } | undefined)
        ?.projectId;
      if (
        typeof projectId === "string" &&
        !requireProjectScope(context.apiKey, projectId)
      ) {
        throw errors.FORBIDDEN();
      }
    }
    return next();
  });

export const projectScopedProcedure = orgScopedProcedure.use(
  projectScopeMiddleware,
);
