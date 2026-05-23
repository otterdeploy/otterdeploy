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

const mapErr = (
  result: { ok: false; reason: string; cause?: unknown },
  errors: Record<string, () => Error>,
) => {
  switch (result.reason) {
    case "project_not_found":
    case "service_not_found":
      return errors.NOT_FOUND?.() ?? new Error(result.reason);
    case "service_conflict":
      return errors.CONFLICT?.() ?? new Error(result.reason);
    case "no_http_port":
      return errors.NO_HTTP_PORT?.() ?? new Error(result.reason);
    case "in_use":
      return errors.IN_USE?.() ?? new Error(result.reason);
    case "ref_missing":
      return errors.REF_MISSING?.() ?? new Error(result.reason);
    case "ref_cycle":
      return errors.REF_CYCLE?.() ?? new Error(result.reason);
    case "ref_unknown_var":
    case "ref_parse_error":
      return errors.INVALID_INPUT?.() ?? new Error(result.reason);
    default:
      return new Error(result.reason);
  }
};

export const serviceRouter = {
  list: orgScopedProcedure.service.list.handler(async ({ input, context, errors }) => {
    const result = await listServices({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  get: orgScopedProcedure.service.get.handler(async ({ input, context, errors }) => {
    const result = await getService({
      ...input,
      organizationId: context.activeOrganizationId,
    });
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  create: orgScopedProcedure.service.create.handler(async ({ input, context, errors }) => {
    const result = await createService(
      { ...input, organizationId: context.activeOrganizationId },
      context.log,
    );
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  update: orgScopedProcedure.service.update.handler(async ({ input, context, errors }) => {
    const result = await updateService(
      { ...input, organizationId: context.activeOrganizationId },
      context.log,
    );
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  delete: orgScopedProcedure.service.delete.handler(async ({ input, context, errors }) => {
    const result = await deleteService(
      { ...input, organizationId: context.activeOrganizationId },
      context.log,
    );
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  restart: orgScopedProcedure.service.restart.handler(async ({ input, context, errors }) => {
    const result = await restartService(
      { ...input, organizationId: context.activeOrganizationId },
      context.log,
    );
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  expose: orgScopedProcedure.service.expose.handler(async ({ input, context, errors }) => {
    const result = await exposeService(
      { ...input, organizationId: context.activeOrganizationId },
      context.log,
    );
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  unexpose: orgScopedProcedure.service.unexpose.handler(async ({ input, context, errors }) => {
    const result = await unexposeService(
      { ...input, organizationId: context.activeOrganizationId },
      context.log,
    );
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  env: {
    list: orgScopedProcedure.service.env.list.handler(async ({ input, context, errors }) => {
      const result = await listEnv({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),

    set: orgScopedProcedure.service.env.set.handler(async ({ input, context, errors }) => {
      const result = await setEnv(
        { ...input, organizationId: context.activeOrganizationId },
        context.log,
      );
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),

    unset: orgScopedProcedure.service.env.unset.handler(async ({ input, context, errors }) => {
      const result = await unsetEnv(
        { ...input, organizationId: context.activeOrganizationId },
        context.log,
      );
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),

    bulkSet: orgScopedProcedure.service.env.bulkSet.handler(
      async ({ input, context, errors }) => {
        const result = await bulkSetEnv(
          { ...input, organizationId: context.activeOrganizationId },
          context.log,
        );
        if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
        return result.value;
      },
    ),
  },
};
