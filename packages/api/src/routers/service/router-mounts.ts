/**
 * `service.mounts.*` oRPC procedures — persistent-volume management for a plain
 * service. Split out of index.ts to keep the router module under the line cap;
 * spread back in as `serviceRouter.mounts`.
 */
import { matchError } from "better-result";

import { projectScopedProcedure, requirePermission } from "../..";
import { addVolumeMount, listVolumeMounts, removeVolumeMount } from "./mount-handlers";

export const serviceMountsRouter = {
  list: projectScopedProcedure.service.mounts.list.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "resource", id: input.resourceId, projectId: input.projectId },
    });
    const result = await listVolumeMounts({
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

  add: requirePermission({ service: ["update"] }).service.mounts.add.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await addVolumeMount(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          mountPath: input.mountPath,
          readOnly: input.readOnly,
        },
        context.log,
      );
      if (result.isErr()) {
        throw matchError(result.error, {
          ProjectNotFoundError: () => errors.NOT_FOUND(),
          ServiceNotFoundError: () => errors.NOT_FOUND(),
          // Env-resolution failures can't occur on a mount add (no vars change),
          // but the RedeployFailure union carries them — map to NOT_FOUND's
          // sibling generic path defensively.
          RefMissingResourceError: (e) => new Error(e.message),
          RefCycleError: (e) => new Error(e.message),
          RefParseError: (e) => new Error(e.message),
          RefUnknownVarError: (e) => new Error(e.message),
        });
      }
      return result.value;
    },
  ),

  remove: requirePermission({ service: ["update"] }).service.mounts.remove.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId, projectId: input.projectId },
      });
      const result = await removeVolumeMount(
        {
          projectId: input.projectId,
          resourceId: input.resourceId,
          organizationId: context.activeOrganizationId,
          mountPath: input.mountPath,
        },
        context.log,
      );
      if (result.isErr()) {
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
};
