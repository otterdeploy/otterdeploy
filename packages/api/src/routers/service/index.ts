import type { DeploymentId } from "@otterdeploy/shared/id";

import { matchError } from "better-result";

import { projectScopedProcedure, requirePermission } from "../..";
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
          MissingProjectBuildBindingError: () => errors.MISSING_BUILD_BINDING(),
          RefMissingResourceError: () => errors.REF_MISSING(),
          RefCycleError: () => errors.REF_CYCLE(),
          RefParseError: () => errors.INVALID_INPUT(),
          RefUnknownVarError: () => errors.INVALID_INPUT(),
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
        });
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
      const result = await rollbackService(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          deploymentId: input.deploymentId as DeploymentId,
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
        });
      }
      return result.value;
    },
  ),

  ...serviceRuntimeRouter,

  env: serviceEnvRouter,

  domains: serviceDomainsRouter,
};
