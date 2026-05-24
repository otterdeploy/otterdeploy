import { matchError } from "better-result";

import { orgScopedProcedure } from "../..";

import { createEnv, deleteEnv, getEnv, listEnvs } from "./handlers";

export const envRouter = {
  list: orgScopedProcedure.env.list.handler(async ({ input, context }) => {
    return listEnvs({
      organizationId: context.activeOrganizationId,
      projectId: input?.projectId,
    });
  }),

  get: orgScopedProcedure.env.get.handler(
    async ({ input, context, errors }) => {
      const result = await getEnv({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          EnvironmentNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  create: orgScopedProcedure.env.create.handler(
    async ({ input, errors }) => {
      const result = await createEnv(input);
      if (result.isErr()) {
        throw matchError(result.error, {
          EnvironmentConflictError: () => errors.CONFLICT(),
        });
      }
      return result.value;
    },
  ),

  delete: orgScopedProcedure.env.delete.handler(
    async ({ input, context, errors }) => {
      const result = await deleteEnv({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          EnvironmentNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
