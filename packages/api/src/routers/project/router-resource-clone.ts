/**
 * Transport bindings for cloning a set of resources. Behaviour lives in
 * ./clone; this file only maps inputs, permissions, and errors.
 *
 * Cloning creates resources, so it takes `service: ["create"]` — the same
 * permission a hand-made service needs. A member who cannot create one service
 * must not be able to create nine by copying them.
 */

import { matchError } from "better-result";

import { requirePermission } from "../../index";
import { cloneResources, previewClone } from "./clone/handler";

export const clonePreviewHandler = requirePermission({
  service: ["create"],
}).project.resource.clonePreview.handler(async ({ input, context, errors }) => {
  context.log.set({
    target: { type: "project", id: input.projectId },
    clone: { previewing: input.resourceIds.length },
  });
  const result = await previewClone({
    projectId: input.projectId,
    organizationId: context.activeOrganizationId,
    resourceIds: input.resourceIds,
  });
  if (result.isErr()) {
    throw matchError(result.error, {
      CloneProjectNotFoundError: () => errors.NOT_FOUND(),
      CloneEmptySelectionError: (e) => errors.INVALID_INPUT({ message: e.message }),
    });
  }
  return result.value;
});

export const cloneHandler = requirePermission({
  service: ["create"],
}).project.resource.clone.handler(async ({ input, context, errors }) => {
  context.log.set({
    target: { type: "project", id: input.projectId },
    clone: { requested: input.resourceIds.length },
  });
  const result = await cloneResources(
    {
      projectId: input.projectId,
      organizationId: context.activeOrganizationId,
      resourceIds: input.resourceIds,
    },
    context.log,
  );
  if (result.isErr()) {
    throw matchError(result.error, {
      CloneProjectNotFoundError: () => errors.NOT_FOUND(),
      CloneEmptySelectionError: (e) => errors.INVALID_INPUT({ message: e.message }),
    });
  }
  return result.value;
});
