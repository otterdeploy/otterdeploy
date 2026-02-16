import * as z from "zod";
import { resourceLinkService } from "@otterstack/domain";

import { orgMemberProcedure } from "../index";
import { unwrapResult } from "../utils/result";

export const resourceLinkRouter = {
  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        sourceResourceId: z.string().min(1),
        targetResourceId: z.string().min(1),
        linkType: z.enum(["depends_on", "network", "mounts"]).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await resourceLinkService.createResourceLink({
          projectId: input.projectId,
          environmentId: input.environmentId,
          organizationId: context.organizationId,
          sourceResourceId: input.sourceResourceId,
          targetResourceId: input.targetResourceId,
          linkType: input.linkType,
        }),
      );
    }),

  delete: orgMemberProcedure
    .input(
      z.object({
        linkId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await resourceLinkService.deleteResourceLink(input.linkId, context.organizationId),
      );
    }),
};
