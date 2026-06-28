/**
 * `service.domains.*` oRPC procedures — split out of index.ts to keep the
 * router module under the line cap. Spread back in as `serviceRouter.domains`.
 */
import type { ProxyRouteId } from "@otterdeploy/shared/id";

import { matchError } from "better-result";

import { projectScopedProcedure, requirePermission } from "../..";
import {
  addServiceDomain,
  listServiceDomains,
  recheckServiceDomain,
  removeServiceDomain,
  setPrimaryServiceDomain,
  updateServiceDomain,
} from "./domains";

export const serviceDomainsRouter = {
  list: projectScopedProcedure.service.domains.list.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await listServiceDomains({
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      throw matchError(result.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        ServiceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    return result.value;
  }),

  add: requirePermission({ service: ["update"] }).service.domains.add.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await addServiceDomain(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          domain: input.domain,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          NoHttpPortError: () => errors.NO_HTTP_PORT(),
          DomainConflictError: () => errors.DOMAIN_CONFLICT(),
        });
      }
      return result.value;
    },
  ),

  update: requirePermission({ service: ["update"] }).service.domains.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await updateServiceDomain(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          routeId: input.routeId as ProxyRouteId,
          domain: input.domain,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          DomainNotFoundError: () => errors.DOMAIN_NOT_FOUND(),
          DomainConflictError: () => errors.DOMAIN_CONFLICT(),
        });
      }
      return result.value;
    },
  ),

  recheck: requirePermission({ service: ["update"] }).service.domains.recheck.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await recheckServiceDomain(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          routeId: input.routeId as ProxyRouteId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          DomainNotFoundError: () => errors.DOMAIN_NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  setPrimary: requirePermission({ service: ["update"] }).service.domains.setPrimary.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await setPrimaryServiceDomain(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          routeId: input.routeId as ProxyRouteId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          DomainNotFoundError: () => errors.DOMAIN_NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  remove: requirePermission({ service: ["update"] }).service.domains.remove.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await removeServiceDomain(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          routeId: input.routeId as ProxyRouteId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          DomainNotFoundError: () => errors.DOMAIN_NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
