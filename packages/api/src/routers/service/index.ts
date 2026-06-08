import { matchError } from "better-result";
import { createError } from "evlog";

import { orgScopedProcedure } from "../..";

import { enqueueGitBuild } from "../project/manifest-apply";

import { loadResource } from "./context";
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

  build: orgScopedProcedure.service.build.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const loaded = await loadResource({
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
    });
    if (loaded.isErr()) {
      throw matchError(loaded.error, {
        ProjectNotFoundError: () => errors.NOT_FOUND(),
        ServiceNotFoundError: () => errors.NOT_FOUND(),
      });
    }
    if (loaded.value.record.service.source !== "git") {
      throw errors.NOT_GIT_SOURCED();
    }
    const enqueued = await enqueueGitBuild({
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
      resourceId: input.resourceId,
      log: context.log,
    });
    if (enqueued.isErr()) {
      // enqueueGitBuild yields a human-readable reason (no git binding, a
      // SHA-lookup 404 for an inaccessible repo, …). Surface it so the UI
      // shows why the build couldn't start instead of a generic 500.
      throw createError({
        message: enqueued.error,
        status: 422,
        why: "git build could not be enqueued",
      });
    }
    return { deploymentId: enqueued.value.deploymentId };
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
