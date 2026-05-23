import { publicProcedure } from "../..";

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
  list: publicProcedure.service.list.handler(async ({ input, errors }) => {
    const result = await listServices(input);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  get: publicProcedure.service.get.handler(async ({ input, errors }) => {
    const result = await getService(input);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  create: publicProcedure.service.create.handler(async ({ input, context, errors }) => {
    const result = await createService(input, context.log);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  update: publicProcedure.service.update.handler(async ({ input, context, errors }) => {
    const result = await updateService(input, context.log);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  delete: publicProcedure.service.delete.handler(async ({ input, context, errors }) => {
    const result = await deleteService(input, context.log);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  restart: publicProcedure.service.restart.handler(async ({ input, context, errors }) => {
    const result = await restartService(input, context.log);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  expose: publicProcedure.service.expose.handler(async ({ input, context, errors }) => {
    const result = await exposeService(input, context.log);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  unexpose: publicProcedure.service.unexpose.handler(async ({ input, context, errors }) => {
    const result = await unexposeService(input, context.log);
    if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
    return result.value;
  }),

  env: {
    list: publicProcedure.service.env.list.handler(async ({ input, errors }) => {
      const result = await listEnv(input);
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),

    set: publicProcedure.service.env.set.handler(async ({ input, context, errors }) => {
      const result = await setEnv(input, context.log);
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),

    unset: publicProcedure.service.env.unset.handler(async ({ input, context, errors }) => {
      const result = await unsetEnv(input, context.log);
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),

    bulkSet: publicProcedure.service.env.bulkSet.handler(async ({ input, context, errors }) => {
      const result = await bulkSetEnv(input, context.log);
      if (!result.ok) throw mapErr(result, errors as Record<string, () => Error>);
      return result.value;
    }),
  },
};
