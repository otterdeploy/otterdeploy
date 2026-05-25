import { matchError } from "better-result";
import { createError } from "evlog";

import { orgScopedProcedure } from "../..";

import type { ResolveError } from "./errors";
import {
  bulkSetEnv,
  createService,
  deleteService,
  exposeService,
  getService,
  listEnv,
  listServices,
  restartService,
  setEnv,
  unexposeService,
  unsetEnv,
  updateService,
} from "./handlers";

// Variable resolution errors aren't enumerated by the service.env.unset
// contract, so they leave the procedure as a generic 500 with a structured
// `why` for the log drain.
const refToServerError = (e: ResolveError) =>
  createError({
    message: e.message,
    status: 500,
    why: `Variable resolution failed: ${e._tag}`,
    cause: e,
  });

export const serviceRouter = {
  list: orgScopedProcedure.service.list.handler(async ({ input, context, errors }) => {
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

  get: orgScopedProcedure.service.get.handler(async ({ input, context, errors }) => {
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

  create: orgScopedProcedure.service.create.handler(async ({ input, context, errors }) => {
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
  }),

  update: orgScopedProcedure.service.update.handler(async ({ input, context, errors }) => {
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
  }),

  delete: orgScopedProcedure.service.delete.handler(async ({ input, context, errors }) => {
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
  }),

  restart: orgScopedProcedure.service.restart.handler(async ({ input, context, errors }) => {
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
  }),

  expose: orgScopedProcedure.service.expose.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await exposeService(
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
      });
    }
    return result.value;
  }),

  unexpose: orgScopedProcedure.service.unexpose.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await unexposeService(
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
      });
    }
    return result.value;
  }),

  env: {
    list: orgScopedProcedure.service.env.list.handler(async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await listEnv({
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

    set: orgScopedProcedure.service.env.set.handler(async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await setEnv(
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
    }),

    unset: orgScopedProcedure.service.env.unset.handler(async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await unsetEnv(
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
          RefMissingResourceError: refToServerError,
          RefCycleError: refToServerError,
          RefParseError: refToServerError,
          RefUnknownVarError: refToServerError,
        });
      }
      return result.value;
    }),

    bulkSet: orgScopedProcedure.service.env.bulkSet.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "resource", id: input.resourceId, projectId: input.projectId },
        });
        const result = await bulkSetEnv(
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
  },
};
