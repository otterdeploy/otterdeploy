import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { matchError } from "better-result";

import { projectScopedProcedure, requirePermission } from "../..";
import { recordAuditChanges } from "../../audit/changes";
import {
  createService,
  deleteService,
  getService,
  listServices,
  restartService,
  rollbackService,
  updateService,
} from "./handlers";
import { serviceDomainsRouter } from "./router-domains";
import { serviceEnvRouter } from "./router-env";
import { serviceMountsRouter } from "./router-mounts";
import { serviceRuntimeRouter } from "./router-runtime";

export const serviceRouter = {
  list: projectScopedProcedure.service.list.handler(async ({ input, context, errors }) => {
    const result = await listServices({
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

  get: projectScopedProcedure.service.get.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await getService({
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

  create: requirePermission({ service: ["create"] }).service.create.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", kind: "service", projectId: input.projectId },
      });
      const result = await createService(
        {
          ...input,
          projectId: input.projectId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceConflictError: () => errors.CONFLICT(),
          MissingServiceBuildBindingError: () => errors.MISSING_BUILD_BINDING(),
          RefMissingResourceError: () => errors.REF_MISSING(),
          RefCycleError: () => errors.REF_CYCLE(),
          RefParseError: () => errors.INVALID_INPUT(),
          RefUnknownVarError: () => errors.INVALID_INPUT(),
          // Not enumerated by the contract; surfaces as a generic 500 with
          // the provider-facing reason in the message.
          VaultResolveError: (e) => new Error(e.message),
        });
      }
      context.log.set({
        target: {
          type: "resource",
          kind: "service",
          id: result.value.id,
          projectId: input.projectId,
        },
      });
      return result.value;
    },
  ),

  update: requirePermission({ service: ["update"] }).service.update.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      // Snapshot first: `service.update` covers replicas, health checks, ports,
      // build config and source, and a row saying only "the service was
      // updated" answers none of the questions asked of it afterwards. Read
      // failures are ignored. An update the caller is entitled to must not
      // fail because the audit diff could not be built.
      const before = await getService({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      const result = await updateService(
        {
          ...input,
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
          RefMissingResourceError: () => errors.REF_MISSING(),
          RefCycleError: () => errors.REF_CYCLE(),
          RefParseError: () => errors.INVALID_INPUT(),
          RefUnknownVarError: () => errors.INVALID_INPUT(),
          // Not enumerated by the contract; surfaces as a generic 500 with
          // the provider-facing reason in the message.
          VaultResolveError: (e) => new Error(e.message),
        });
      }
      if (before.isOk()) {
        recordAuditChanges(context, { before: before.value, after: result.value });
      }
      return result.value;
    },
  ),

  delete: requirePermission({ service: ["delete"] }).service.delete.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await deleteService(
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
          ServiceInUseError: () => errors.IN_USE(),
        });
      }
      return result.value;
    },
  ),

  restart: requirePermission({ service: ["deploy"] }).service.restart.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await restartService(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
        },
        context.log,
      );
      if (result.isErr()) {
        // restartService can propagate ResolveError via fan-out redeploy; the
        // contract doesn't enumerate REF_* so they surface as generic 500s.
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          RefMissingResourceError: (e) => new Error(e.message),
          RefCycleError: (e) => new Error(e.message),
          RefParseError: (e) => new Error(e.message),
          RefUnknownVarError: (e) => new Error(e.message),
          VaultResolveError: (e) => new Error(e.message),
        });
      }
      return result.value;
    },
  ),

  rollback: requirePermission({ service: ["deploy"] }).service.rollback.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
        rollbackToDeploymentId: input.deploymentId,
      });
      // The contract accepts a plain string; the prefix check is the boundary
      // that brands it. A malformed id can't name any deployment: NOT_FOUND.
      if (!hasPrefix(input.deploymentId, ID_PREFIX.deployment)) throw errors.NOT_FOUND();
      const result = await rollbackService(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          deploymentId: input.deploymentId,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          NotRollbackableError: (e) => errors.NOT_ROLLBACKABLE({ message: e.message }),
          RefMissingResourceError: (e) => new Error(e.message),
          RefCycleError: (e) => new Error(e.message),
          RefParseError: (e) => new Error(e.message),
          RefUnknownVarError: (e) => new Error(e.message),
          VaultResolveError: (e) => new Error(e.message),
        });
      }
      return result.value;
    },
  ),

  ...serviceRuntimeRouter,

  env: serviceEnvRouter,

  domains: serviceDomainsRouter,

  mounts: serviceMountsRouter,
};
