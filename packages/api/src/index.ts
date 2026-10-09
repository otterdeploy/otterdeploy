import type { PermissionCheck } from "@otterdeploy/auth/permissions";

import { implement, os as orpc } from "@orpc/server";

import type { Context } from "./context";

import { authorizeCapability } from "./authz/capability";
import { apiKeyRateLimitedError, orgScopedMiddleware } from "./authz/org-scope-middleware";
import { isReadAction, isReadMethod } from "./authz/procedure-mode";
import { procedureTimeout } from "./authz/procedure-timeout";
import { traceProcedure } from "./authz/procedure-trace";
import { authorizeProjectRefs } from "./authz/project-ref-scope";
import { analyticsContract } from "./routers/analytics/contract";
import { apiKeysContract } from "./routers/apiKeys/contract";
import { auditContract } from "./routers/audit/contract";
import { backupsContract } from "./routers/backups/contract";
import { certificatesContract } from "./routers/certificates/contract";
import { composeContract } from "./routers/compose/contract";
import { dataContract } from "./routers/data/contract";
import { databaseContract } from "./routers/database/contract";
import { deploymentContract } from "./routers/deployment/contract";
import { dnsContract } from "./routers/dns/contract";
import { dockerContract } from "./routers/docker/contract";
import { edgeLogsContract } from "./routers/edge-logs/contract";
import { envContract } from "./routers/env/contract";
import { eventsContract } from "./routers/events/contract";
import { firewallContract } from "./routers/firewall/contract";
import { gitContract } from "./routers/git/contract";
import { meshContract } from "./routers/mesh/contract";
import { metricsContract } from "./routers/metrics/contract";
import { migrateContract } from "./routers/migrate/contract";
import { notificationsContract } from "./routers/notifications/contract";
import { organizationContract } from "./routers/organization/contract";
import { projectContract } from "./routers/project/contract";
import { registryContract } from "./routers/registry/contract";
import { serverContract } from "./routers/server/contract";
import { serviceContract } from "./routers/service/contract";
import { sshKeysContract } from "./routers/sshKeys/contract";
import { ssoContract } from "./routers/sso/contract";
import { storageContract } from "./routers/storage/contract";
import { systemContract } from "./routers/system/contract";
import { terminalContract } from "./routers/terminal/contract";
import { vaultProviderContract } from "./routers/vault-provider/contract";
import { volumesContract } from "./routers/volumes/contract";
import { webhooksContract } from "./routers/webhooks/contract";

export const publicProcedure = implement({
  analytics: analyticsContract,
  apiKeys: apiKeysContract,
  audit: auditContract,
  backups: backupsContract,
  certificates: certificatesContract,
  compose: composeContract,
  data: dataContract,
  database: databaseContract,
  deployment: deploymentContract,
  sso: ssoContract,
  dns: dnsContract,
  docker: dockerContract,
  edgeLogs: edgeLogsContract,
  env: envContract,
  events: eventsContract,
  firewall: firewallContract,
  git: gitContract,
  mesh: meshContract,
  metrics: metricsContract,
  migrate: migrateContract,
  notifications: notificationsContract,
  organization: organizationContract,
  project: projectContract,
  registry: registryContract,
  server: serverContract,
  service: serviceContract,
  sshKeys: sshKeysContract,
  storage: storageContract,
  system: systemContract,
  terminal: terminalContract,
  vaultProvider: vaultProviderContract,
  volumes: volumesContract,
  webhooks: webhooksContract,
})
  .$context<Context>()
  .use(traceProcedure)
  // Inside the trace so a timeout is recorded as a failure with a duration,
  // not as a request that simply never produced a wide event (od-664).
  .use(procedureTimeout);

const authMiddleware = orpc
  .$context<Context>()
  .errors({
    UNAUTHORIZED: {
      message: "Unauthorized",
    },
    TOO_MANY_REQUESTS: apiKeyRateLimitedError,
  })
  .middleware(async ({ context, next, errors }) => {
    // A session/cookie/CLI-bearer user OR a verified API-key actor counts as
    // authenticated. Session-identity handlers still read `context.session`
    // directly (null for key actors): guard there if they need a real user.
    if (!context.actor) {
      if (context.apiKeyRateLimited) {
        throw errors.TOO_MANY_REQUESTS({
          message: context.apiKeyRateLimited.message,
          data: { retryAfterSeconds: context.apiKeyRateLimited.retryAfterSeconds },
        });
      }
      throw errors.UNAUTHORIZED();
    }
    return next({
      context: {
        actor: context.actor,
        session: context.session,
        apiKey: context.apiKey,
      },
    });
  });

export const protectedProcedure = publicProcedure.use(authMiddleware);

/**
 * Constrains an API-key actor to the project(s) its scope allows, for EVERY
 * org-scoped procedure: each input field that names a project, or
 * an object a project owns, is resolved to that project, as the procedure
 * declares it (authz/project-refs.ts: conventional field names, plus the
 * contract's `meta.projectRefs` for `id`, `slug` and nested paths). An
 * id-like field with no declaration fails closed. Session/cookie actors and
 * keys not minted with `projectScope: "selected"` pass without a query.
 */
const projectScopeMiddleware = orpc
  .$context<Context>()
  .errors({
    FORBIDDEN: {
      status: 403,
      message: "This API key is not scoped to that project.",
    },
  })
  .middleware(async ({ context, procedure, next, errors }, input: unknown) => {
    if (context.apiKey && context.activeOrganizationId) {
      const decision = await authorizeProjectRefs(
        context.apiKey,
        context.activeOrganizationId,
        procedure["~orpc"].meta,
        input,
      );
      if (!decision.allowed) {
        throw errors.FORBIDDEN({ message: decision.reason });
      }
    }
    return next();
  });

export const orgScopedProcedure = publicProcedure
  .use(orgScopedMiddleware)
  .use(projectScopeMiddleware);

/**
 * Installation administration is a server-owned user attribute, never an
 * organization role and never an organization API key.
 */
const installAdminMiddleware = orpc
  .$context<Context>()
  .errors({
    FORBIDDEN: {
      status: 403,
      message: "Installation administrator access is required.",
    },
  })
  .middleware(async ({ context, procedure, next, errors }) => {
    const definition = procedure["~orpc"];
    const mode = (isReadMethod(definition.meta, definition.route) ?? false) ? "read" : "write";
    const decision = await authorizeCapability(context.actor, {
      scope: "install",
      mode,
    });
    if (!decision.allowed) {
      throw errors.FORBIDDEN({ message: decision.reason });
    }
    return next();
  });

export function requireInstallAdmin() {
  return orgScopedProcedure.use(installAdminMiddleware);
}

/**
 * Build an org-scoped procedure that additionally requires a specific RBAC
 * permission. Role resolution + the permission check are delegated to
 * better-auth's `auth.api.hasPermission` (statements/roles defined in
 * `@otterdeploy/auth/permissions`), no hand-rolled member-table lookups. Being
 * org-scoped, the returned procedure ALSO carries the api-key project-scope
 * guard, so a gated mutation enforces RBAC, the key's resource scope, AND the
 * key's project scope in one place.
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
    .middleware(async ({ context, path, procedure, next, errors }, input: unknown) => {
      if (!context.activeOrganizationId) {
        throw errors.FORBIDDEN({ message: "An active organization is required." });
      }
      const definition = procedure["~orpc"];
      const mode =
        (isReadMethod(definition.meta, definition.route) ?? isReadAction(path.join(".")))
          ? "read"
          : "write";
      const projectId =
        input !== null && typeof input === "object" && "projectId" in input
          ? input.projectId
          : undefined;
      const decision = await authorizeCapability(context.actor, {
        scope: "organization",
        mode,
        organizationId: context.activeOrganizationId,
        permission,
        projectId: typeof projectId === "string" ? projectId : undefined,
      });
      if (!decision.allowed) {
        throw errors.FORBIDDEN({ message: decision.reason });
      }
      return next();
    });

  return orgScopedProcedure.use(permissionMiddleware);
}

/**
 * Instance-wide mutations may also have an organization permission for custom
 * role policy. Require both: organization ownership/admin alone never grants
 * host authority, and install-admin status does not bypass the declared RBAC
 * capability inside the active organization.
 */
export function requireInstallAdminPermission(permission: PermissionCheck) {
  return requirePermission(permission).use(installAdminMiddleware);
}

/**
 * Org-scoped procedure for project-scoped READ procedures (and any mutation
 * gated some other way). Every org-scoped builder now carries the api-key
 * project-scope guard, so this is `orgScopedProcedure` under the name that
 * says what the procedure reads; mutating project procedures should prefer
 * `requirePermission`, which layers the RBAC check on top.
 */
export const projectScopedProcedure = orgScopedProcedure;

export { isReadAction, isReadMethod } from "./authz/procedure-mode";
