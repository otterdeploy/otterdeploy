import { ORPCError } from "@orpc/server";
import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import {
  createDeploymentBypassToken,
  createDeploymentShareLink,
  getGlobalCaddyOptions,
  getProjectCaddyfile,
  getProjectCustomCaddyConfig,
  inviteDeploymentGuest,
  listDeploymentGuests,
  listProjectCertificates,
  listProjectProxyRoutes,
  removeDeploymentGuest,
  saveGlobalCaddyOptions,
  saveProjectCustomCaddyConfig,
  setProxyRouteDirectives,
  setProxyRouteProtection,
} from "./handlers";

export const proxyRouteRouter = {
  list: orgScopedProcedure.project.proxyRoute.list.handler(async ({ input, context, errors }) => {
    const result = await listProjectProxyRoutes({
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  caddyfile: orgScopedProcedure.project.proxyRoute.caddyfile.handler(
    async ({ input, context, errors }) => {
      const result = await getProjectCaddyfile({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  certificates: orgScopedProcedure.project.proxyRoute.certificates.handler(
    async ({ input, context, errors }) => {
      const result = await listProjectCertificates({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  customConfig: orgScopedProcedure.project.proxyRoute.customConfig.handler(
    async ({ input, context, errors }) => {
      const result = await getProjectCustomCaddyConfig({
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  setCustomConfig: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setCustomConfig.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    const result = await saveProjectCustomCaddyConfig(
      {
        projectId: input.projectId,
        config: input.config,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  globalOptions: orgScopedProcedure.project.proxyRoute.globalOptions.handler(async () =>
    getGlobalCaddyOptions(),
  ),

  // Instance-wide edge options — gated on firewall:update (admin/owner), since
  // a single project's member shouldn't change the whole install's HTTPS behavior.
  setGlobalOptions: requirePermission({
    firewall: ["update"],
  }).project.proxyRoute.setGlobalOptions.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    return saveGlobalCaddyOptions(
      {
        acmeEmail: input.acmeEmail,
        httpsAutoRedirect: input.httpsAutoRedirect,
      },
      context.log,
    );
  }),

  setRouteDirectives: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setRouteDirectives.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "proxy-route", id: input.routeId } });
    const result = await setProxyRouteDirectives(
      {
        routeId: input.routeId,
        directives: input.directives,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      throw matchError(result.error, {
        ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  setProtection: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setProtection.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "proxy-route", id: input.routeId } });
    const result = await setProxyRouteProtection(
      {
        routeId: input.routeId,
        protected: input.protected,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      throw matchError(result.error, {
        ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  createShareLink: requirePermission({
    route: ["update"],
  }).project.proxyRoute.createShareLink.handler(async ({ input, context, errors }) => {
    const result = await createDeploymentShareLink({
      routeId: input.routeId,
      expiresInHours: input.expiresInHours,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  createBypassToken: requirePermission({
    route: ["update"],
  }).project.proxyRoute.createBypassToken.handler(async ({ input, context, errors }) => {
    const result = await createDeploymentBypassToken({
      routeId: input.routeId,
      expiresInDays: input.expiresInDays,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  listGuests: orgScopedProcedure.project.proxyRoute.listGuests.handler(
    async ({ input, context, errors }) => {
      const result = await listDeploymentGuests({
        routeId: input.routeId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  inviteGuest: requirePermission({ route: ["update"] }).project.proxyRoute.inviteGuest.handler(
    async ({ input, context, errors }) => {
      // Guest invites are attributed to the inviting user — a session-only
      // operation; reject API-key actors (which have no user identity).
      if (!context.session?.user) {
        throw new ORPCError("UNAUTHORIZED");
      }
      const result = await inviteDeploymentGuest({
        routeId: input.routeId,
        email: input.email,
        sessionHours: input.sessionHours,
        organizationId: context.activeOrganizationId,
        invitedByUserId: context.session.user.id,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  removeGuest: requirePermission({ route: ["update"] }).project.proxyRoute.removeGuest.handler(
    async ({ input, context, errors }) => {
      const result = await removeDeploymentGuest({
        routeId: input.routeId,
        guestId: input.guestId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProxyRouteNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
