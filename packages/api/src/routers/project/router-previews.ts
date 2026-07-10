/**
 * Previews sub-router — list, lifecycle controls (rebuild/pause/keep-alive/
 * teardown), DB branching, and per-preview env overrides. Split out of the
 * project router index, which mounts this under `project.previews`.
 */
import type { OrganizationId, PreviewId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { matchError } from "better-result";

import { orgScopedProcedure, requirePermission } from "../../index";
import { ProjectNotFoundError } from "./errors";
import {
  disablePreviewDbBranch,
  enablePreviewDbBranch,
  pausePreview,
  rebuildPreview,
  redeployPreview,
  resetPreviewDbBranch,
  resumePreview,
  setPreviewKeepAlive,
  teardownPreviewNow,
} from "./previews-controls";
import {
  listPreviewEffectiveEnv,
  listPreviewEnvOverrides,
  setPreviewEnvOverride,
  unsetPreviewEnvOverride,
} from "./previews-env";
import { listProjectPreviews } from "./previews-list";

// Shared boilerplate for preview-level POST controls (rebuild/pause/etc.):
// stamp the log target, call the handler with the org-scoped input, map the
// not-found error. The control handlers all take (scope, log?) and return a
// Result<record, ProjectNotFoundError>.
async function previewCtl<T>(
  fn: (
    input: { projectId: ProjectId; previewId: PreviewId; organizationId: OrganizationId },
    log?: RequestLogger,
  ) => Promise<import("better-result").Result<T, InstanceType<typeof ProjectNotFoundError>>>,
  input: { projectId: ProjectId; previewId: PreviewId },
  context: { activeOrganizationId: OrganizationId; log: RequestLogger },
  errors: { NOT_FOUND: () => unknown },
): Promise<T> {
  context.log.set({ target: { type: "project", id: input.projectId } });
  const result = await fn(
    {
      projectId: input.projectId,
      previewId: input.previewId,
      organizationId: context.activeOrganizationId,
    },
    context.log,
  );
  if (result.isErr()) {
    throw matchError(result.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
  }
  return result.value;
}

export const previewsRouter = {
  list: orgScopedProcedure.project.previews.list.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "project", id: input.projectId } });
    const result = await listProjectPreviews({
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

  rebuild: requirePermission({ service: ["deploy"] }).project.previews.rebuild.handler(
    async ({ input, context, errors }) => previewCtl(rebuildPreview, input, context, errors),
  ),
  redeploy: requirePermission({ service: ["deploy"] }).project.previews.redeploy.handler(
    async ({ input, context, errors }) => previewCtl(redeployPreview, input, context, errors),
  ),
  pause: requirePermission({ service: ["deploy"] }).project.previews.pause.handler(
    async ({ input, context, errors }) => previewCtl(pausePreview, input, context, errors),
  ),
  resume: requirePermission({ service: ["deploy"] }).project.previews.resume.handler(
    async ({ input, context, errors }) => previewCtl(resumePreview, input, context, errors),
  ),
  teardown: requirePermission({ service: ["delete"] }).project.previews.teardown.handler(
    async ({ input, context, errors }) => previewCtl(teardownPreviewNow, input, context, errors),
  ),
  keepAlive: requirePermission({ service: ["update"] }).project.previews.keepAlive.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "project", id: input.projectId } });
      const result = await setPreviewKeepAlive({
        projectId: input.projectId,
        previewId: input.previewId,
        organizationId: context.activeOrganizationId,
        keepAlive: input.keepAlive,
      });
      if (result.isErr()) {
        throw matchError(result.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
      }
      return result.value;
    },
  ),
  dbBranch: {
    enable: requirePermission({ database: ["update"] }).project.previews.dbBranch.enable.handler(
      async ({ input, context, errors }) =>
        previewCtl(enablePreviewDbBranch, input, context, errors),
    ),
    disable: requirePermission({
      database: ["update"],
    }).project.previews.dbBranch.disable.handler(async ({ input, context, errors }) =>
      previewCtl(disablePreviewDbBranch, input, context, errors),
    ),
    reset: requirePermission({ database: ["update"] }).project.previews.dbBranch.reset.handler(
      async ({ input, context, errors }) =>
        previewCtl(resetPreviewDbBranch, input, context, errors),
    ),
  },

  envVars: {
    effective: orgScopedProcedure.project.previews.envVars.effective.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "project", id: input.projectId } });
        const result = await listPreviewEffectiveEnv({
          ...input,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          throw matchError(result.error, { ProjectNotFoundError: () => errors.NOT_FOUND() });
        }
        return result.value;
      },
    ),
    list: orgScopedProcedure.project.previews.envVars.list.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "project", id: input.projectId } });
        const result = await listPreviewEnvOverrides({
          ...input,
          organizationId: context.activeOrganizationId,
        });
        if (result.isErr()) {
          throw matchError(result.error, {
            ProjectNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),
    set: requirePermission({ env: ["update"] }).project.previews.envVars.set.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "project", id: input.projectId } });
        const result = await setPreviewEnvOverride(
          { ...input, organizationId: context.activeOrganizationId },
          context.log,
        );
        if (result.isErr()) {
          throw matchError(result.error, {
            ProjectNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),
    unset: requirePermission({ env: ["update"] }).project.previews.envVars.unset.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "project", id: input.projectId } });
        const result = await unsetPreviewEnvOverride(
          { ...input, organizationId: context.activeOrganizationId },
          context.log,
        );
        if (result.isErr()) {
          throw matchError(result.error, {
            ProjectNotFoundError: () => errors.NOT_FOUND(),
          });
        }
        return result.value;
      },
    ),
  },
};
