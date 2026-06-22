import type { DeploymentId, ProxyRouteId } from "@otterdeploy/shared/id";
import { matchError } from "better-result";
import { createError } from "evlog";

import { projectScopedProcedure } from "../..";

import { enqueueGitBuild } from "../project/manifest-apply";

import { loadResource } from "./context";
import {
  addServiceDomain,
  listServiceDomains,
  recheckServiceDomain,
  removeServiceDomain,
  setPrimaryServiceDomain,
  updateServiceDomain,
} from "./domains";
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
  rollbackService,
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

  create: projectScopedProcedure.service.create.handler(async ({ input, context, errors }) => {
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

  update: projectScopedProcedure.service.update.handler(async ({ input, context, errors }) => {
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

  delete: projectScopedProcedure.service.delete.handler(async ({ input, context, errors }) => {
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

  restart: projectScopedProcedure.service.restart.handler(async ({ input, context, errors }) => {
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

  rollback: projectScopedProcedure.service.rollback.handler(async ({ input, context, errors }) => {
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
  }),

  build: projectScopedProcedure.service.build.handler(async ({ input, context, errors }) => {
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

  expose: projectScopedProcedure.service.expose.handler(async ({ input, context, errors }) => {
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

  unexpose: projectScopedProcedure.service.unexpose.handler(async ({ input, context, errors }) => {
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
    list: projectScopedProcedure.service.env.list.handler(async ({ input, context, errors }) => {
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

    set: projectScopedProcedure.service.env.set.handler(async ({ input, context, errors }) => {
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

    unset: projectScopedProcedure.service.env.unset.handler(async ({ input, context, errors }) => {
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

    bulkSet: projectScopedProcedure.service.env.bulkSet.handler(
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

  domains: {
    list: projectScopedProcedure.service.domains.list.handler(
      async ({ input, context, errors }) => {
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
      },
    ),

    add: projectScopedProcedure.service.domains.add.handler(
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

    update: projectScopedProcedure.service.domains.update.handler(
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

    recheck: projectScopedProcedure.service.domains.recheck.handler(
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

    setPrimary: projectScopedProcedure.service.domains.setPrimary.handler(
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

    remove: projectScopedProcedure.service.domains.remove.handler(
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
  },
};
