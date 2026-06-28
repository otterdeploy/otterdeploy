/**
 * `service.env.*` oRPC procedures — split out of index.ts to keep the router
 * module under the line cap. Spread back in as `serviceRouter.env`.
 */
import { matchError } from "better-result";
import { createError } from "evlog";

import type { ResolveError } from "./errors";

import { projectScopedProcedure, requirePermission } from "../..";
import { bulkSetEnv, listEnv, setEnv, unsetEnv } from "./handlers";

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

export const serviceEnvRouter = {
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

  set: requirePermission({ service: ["update"] }).service.env.set.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  unset: requirePermission({ service: ["update"] }).service.env.unset.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  bulkSet: requirePermission({ service: ["update"] }).service.env.bulkSet.handler(
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
};
