import { hasMetricsDirective } from "@otterdeploy/shared/custom-directives-reach";
import { matchError } from "better-result";

import { authorizeCapability } from "../../authz/capability";
import {
  orgScopedProcedure,
  requireInstallAdmin,
  requireInstallAdminPermission,
  requirePermission,
} from "../../index";
import {
  getGlobalCaddyOptions,
  getProjectCaddyfile,
  listProjectCertificates,
  listProjectCustomCertHosts,
  listProjectProxyRoutes,
  saveGlobalCaddyOptions,
  setProxyRouteCustomDirectives,
  setProxyRoutePolicy,
  setProxyRouteProtection,
  setProxyRouteUserEnabled,
} from "./handlers";
import { proxyRouteAccessRouter } from "./router-proxy-route-access";

export const proxyRouteRouter = {
  // Access surface (PIN, share links, bypass tokens, guests). See
  // router-proxy-route-access.ts.
  ...proxyRouteAccessRouter,

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

  customCertHosts: orgScopedProcedure.project.proxyRoute.customCertHosts.handler(
    async ({ input, context, errors }) => {
      const result = await listProjectCustomCertHosts({
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

  globalOptions: requireInstallAdmin().project.proxyRoute.globalOptions.handler(async () =>
    getGlobalCaddyOptions(),
  ),

  // Instance-wide edge options, gated on firewall:update (admin/owner), since
  // a single project's member shouldn't change the whole install's HTTPS behavior.
  setGlobalOptions: requireInstallAdminPermission({
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

  setRoutePolicy: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setRoutePolicy.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "proxy-route", id: input.routeId } });
    const result = await setProxyRoutePolicy(
      {
        routeId: input.routeId,
        policy: input.policy,
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

  setCustomDirectives: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setCustomDirectives.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "proxy-route", id: input.routeId } });
    // Raw directives are open to every route editor; `metrics` alone exposes
    // the whole install's traffic, so it is decided by the server-owned
    // install-admin attribute, the same check the install-admin middleware runs.
    if (input.directives !== null && hasMetricsDirective(input.directives)) {
      const decision = await authorizeCapability(context.actor, {
        scope: "install",
        mode: "write",
      });
      if (!decision.allowed) throw errors.FORBIDDEN();
    }
    const result = await setProxyRouteCustomDirectives(
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

  setEnabled: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setEnabled.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "proxy-route", id: input.routeId } });
    const result = await setProxyRouteUserEnabled(
      {
        routeId: input.routeId,
        enabled: input.enabled,
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
};
