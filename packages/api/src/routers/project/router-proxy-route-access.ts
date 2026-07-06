/**
 * Deployment-protection access surface of the proxy-route router: the
 * access PIN, shareable links, CI bypass tokens, and guest invites. Split
 * out of router-proxy-routes.ts (spread back into proxyRouteRouter) to keep
 * that file under the max-lines cap.
 */

import { ORPCError } from "@orpc/server";
import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import {
  createDeploymentBypassToken,
  createDeploymentShareLink,
  getRouteAccessPin,
  inviteDeploymentGuest,
  listDeploymentGuests,
  removeDeploymentGuest,
  setRouteAccessPin,
} from "./handlers";

export const proxyRouteAccessRouter = {
  accessPin: orgScopedProcedure.project.proxyRoute.accessPin.handler(
    async ({ input, context, errors }) => {
      const result = await getRouteAccessPin({
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

  setAccessPin: requirePermission({
    route: ["update"],
  }).project.proxyRoute.setAccessPin.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "proxy-route", id: input.routeId } });
    const result = await setRouteAccessPin({
      routeId: input.routeId,
      pin: input.pin,
      organizationId: context.activeOrganizationId,
    });
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
