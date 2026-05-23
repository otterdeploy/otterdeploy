import { orgScopedProcedure } from "../..";

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

export const serviceRouter = {
  list: orgScopedProcedure.service.list.handler(async ({ input, context, errors }) => {
    const result = await listServices({
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
          throw errors.NOT_FOUND();
      }
    }
    return result.value;
  }),

  get: orgScopedProcedure.service.get.handler(async ({ input, context, errors }) => {
    const result = await getService({
      projectId: input.projectId,
      resourceId: input.resourceId,
      organizationId: context.activeOrganizationId,
    });
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
        case "ServiceNotFoundError":
          throw errors.NOT_FOUND();
      }
    }
    return result.value;
  }),

  create: orgScopedProcedure.service.create.handler(async ({ input, context, errors }) => {
    const result = await createService(
      {
        ...input,
        projectId: input.projectId,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
          throw errors.NOT_FOUND();
        case "ServiceConflictError":
          throw errors.CONFLICT();
        case "RefMissingResourceError":
          throw errors.REF_MISSING();
        case "RefCycleError":
          throw errors.REF_CYCLE();
        case "RefParseError":
        case "RefUnknownVarError":
          throw errors.INVALID_INPUT();
      }
    }
    return result.value;
  }),

  update: orgScopedProcedure.service.update.handler(async ({ input, context, errors }) => {
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
      switch (result.error._tag) {
        case "ProjectNotFoundError":
        case "ServiceNotFoundError":
          throw errors.NOT_FOUND();
        case "RefMissingResourceError":
          throw errors.REF_MISSING();
        case "RefCycleError":
          throw errors.REF_CYCLE();
        case "RefParseError":
        case "RefUnknownVarError":
          throw errors.INVALID_INPUT();
      }
    }
    return result.value;
  }),

  delete: orgScopedProcedure.service.delete.handler(async ({ input, context, errors }) => {
    const result = await deleteService(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
        case "ServiceNotFoundError":
          throw errors.NOT_FOUND();
        case "ServiceInUseError":
          throw errors.IN_USE();
      }
    }
    return result.value;
  }),

  restart: orgScopedProcedure.service.restart.handler(async ({ input, context, errors }) => {
    const result = await restartService(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
        case "ServiceNotFoundError":
          throw errors.NOT_FOUND();
        // restartService can also propagate ResolveError via fan-out redeploy;
        // surface those as generic server errors since this contract does
        // not enumerate them.
        case "RefMissingResourceError":
        case "RefCycleError":
        case "RefParseError":
        case "RefUnknownVarError":
          throw new Error(result.error.message);
      }
    }
    return result.value;
  }),

  expose: orgScopedProcedure.service.expose.handler(async ({ input, context, errors }) => {
    const result = await exposeService(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
        case "ServiceNotFoundError":
          throw errors.NOT_FOUND();
        case "NoHttpPortError":
          throw errors.NO_HTTP_PORT();
      }
    }
    return result.value;
  }),

  unexpose: orgScopedProcedure.service.unexpose.handler(async ({ input, context, errors }) => {
    const result = await unexposeService(
      {
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      },
      context.log,
    );
    if (result.isErr()) {
      switch (result.error._tag) {
        case "ProjectNotFoundError":
        case "ServiceNotFoundError":
          throw errors.NOT_FOUND();
      }
    }
    return result.value;
  }),

  env: {
    list: orgScopedProcedure.service.env.list.handler(async ({ input, context, errors }) => {
      const result = await listEnv({
        projectId: input.projectId,
        resourceId: input.resourceId,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        switch (result.error._tag) {
          case "ProjectNotFoundError":
          case "ServiceNotFoundError":
            throw errors.NOT_FOUND();
        }
      }
      return result.value;
    }),

    set: orgScopedProcedure.service.env.set.handler(async ({ input, context, errors }) => {
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
        switch (result.error._tag) {
          case "ProjectNotFoundError":
          case "ServiceNotFoundError":
            throw errors.NOT_FOUND();
          case "RefMissingResourceError":
            throw errors.REF_MISSING();
          case "RefCycleError":
            throw errors.REF_CYCLE();
          case "RefParseError":
          case "RefUnknownVarError":
            throw errors.INVALID_INPUT();
        }
      }
      return result.value;
    }),

    unset: orgScopedProcedure.service.env.unset.handler(async ({ input, context, errors }) => {
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
        switch (result.error._tag) {
          case "ProjectNotFoundError":
          case "ServiceNotFoundError":
            throw errors.NOT_FOUND();
          // Contract doesn't enumerate REF_* — surface as server error.
          case "RefMissingResourceError":
          case "RefCycleError":
          case "RefParseError":
          case "RefUnknownVarError":
            throw new Error(result.error.message);
        }
      }
      return result.value;
    }),

    bulkSet: orgScopedProcedure.service.env.bulkSet.handler(
      async ({ input, context, errors }) => {
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
          switch (result.error._tag) {
            case "ProjectNotFoundError":
            case "ServiceNotFoundError":
              throw errors.NOT_FOUND();
            case "RefMissingResourceError":
              throw errors.REF_MISSING();
            case "RefCycleError":
              throw errors.REF_CYCLE();
            case "RefParseError":
            case "RefUnknownVarError":
              throw errors.INVALID_INPUT();
          }
        }
        return result.value;
      },
    ),
  },
};
