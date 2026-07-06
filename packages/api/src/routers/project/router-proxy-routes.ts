import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import {
  getGlobalCaddyOptions,
  getProjectCaddyfile,
  getProjectCustomCaddyConfig,
  listProjectCertificates,
  listProjectProxyRoutes,
  saveGlobalCaddyOptions,
  saveProjectCustomCaddyConfig,
  setProxyRouteDirectives,
  setProxyRouteProtection,
} from "./handlers";
import { proxyRouteAccessRouter } from "./router-proxy-route-access";

export const proxyRouteRouter = {
  // Access surface (PIN, share links, bypass tokens, guests) — see
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
};
