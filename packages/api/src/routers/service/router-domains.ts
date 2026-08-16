/**
 * `service.domains.*` oRPC procedures — split out of index.ts to keep the
 * router module under the line cap. Spread back in as `serviceRouter.domains`.
 */
import { matchError } from "better-result";

import { projectScopedProcedure, requirePermission } from "../..";
import { serverIpFor } from "./domain-rules";
import {
  addServiceDomain,
  recheckServiceDomain,
  removeServiceDomain,
  setPrimaryServiceDomain,
  updateServiceDomain,
} from "./domains";
import { autoConfigureServiceDomainDns } from "./domains-autoconfigure";
import { checkServiceDomain, listServiceDomains } from "./domains-check";
import { setServiceDomainEnabled } from "./domains-enabled";
import { generateServiceDomain } from "./expose";

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

  check: projectScopedProcedure.service.domains.check.handler(
    async ({ input, context, errors }) => {
      const result = await checkServiceDomain({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
        domain: input.domain,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  generate: requirePermission({ service: ["update"] }).service.domains.generate.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await generateServiceDomain(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
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
          port: input.port,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          NoHttpPortError: () => errors.NO_HTTP_PORT(),
          UnknownPortError: (e) => errors.UNKNOWN_PORT({ message: e.message }),
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
          routeId: input.routeId,
          domain: input.domain,
          port: input.port,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          DomainNotFoundError: () => errors.DOMAIN_NOT_FOUND(),
          DomainConflictError: () => errors.DOMAIN_CONFLICT(),
          UnknownPortError: (e) => errors.UNKNOWN_PORT({ message: e.message }),
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
          routeId: input.routeId,
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

  autoConfigureDns: requirePermission({
    service: ["update"],
  }).service.domains.autoConfigureDns.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await autoConfigureServiceDomainDns({
      organizationId: context.activeOrganizationId,
      resourceId: input.resourceId,
      routeId: input.routeId,
      serverIp: await serverIpFor({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      }),
    });
    if (result.isErr()) {
      // "not-found" is the only one that is genuinely a missing row; every
      // other reason is a configuration gap the operator can act on, so it
      // keeps its own message rather than collapsing to a bare 400.
      if (result.error.reason === "not-found") throw errors.DOMAIN_NOT_FOUND();
      throw errors.DNS_NOT_CONFIGURABLE({ message: result.error.message });
    }
    return { ok: true, recordIds: result.value.recordIds };
  }),

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
          routeId: input.routeId,
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

  setEnabled: requirePermission({ service: ["update"] }).service.domains.setEnabled.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await setServiceDomainEnabled(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          routeId: input.routeId,
          enabled: input.enabled,
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
          routeId: input.routeId,
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
