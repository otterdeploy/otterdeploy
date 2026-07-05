/**
 * `service.build` / `service.expose` / `service.unexpose` oRPC procedures —
 * split out of index.ts to keep the router module under the line cap. Spread
 * back in as top-level keys of `serviceRouter`.
 */
import { matchError } from "better-result";

import { requirePermission } from "../..";
import { enqueueGitBuild } from "../project/manifest-apply";
import { loadResource } from "./context";
import { exposeService, unexposeService } from "./handlers";

export const serviceRuntimeRouter = {
  build: requirePermission({ service: ["deploy"] }).service.build.handler(
    async ({ input, context, errors }) => {
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
        // SHA-lookup 404 for an inaccessible repo, …). Surface it as a typed
        // oRPC error so the client gets a 422 with that reason — a plain
        // thrown error (e.g. evlog's createError) is serialized as a generic
        // 500 regardless of any status field on it.
        throw errors.BUILD_NOT_READY({ message: enqueued.error });
      }
      return { deploymentId: enqueued.value.deploymentId };
    },
  ),

  expose: requirePermission({ service: ["update"] }).service.expose.handler(
    async ({ input, context, errors }) => {
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
    },
  ),

  unexpose: requirePermission({ service: ["update"] }).service.unexpose.handler(
    async ({ input, context, errors }) => {
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
    },
  ),
};
