import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { resourceLinkService, DomainError } from "@otterstack/domain";

import { orgMemberProcedure } from "../index";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

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
      try {
        return await resourceLinkService.createResourceLink({
          projectId: input.projectId,
          environmentId: input.environmentId,
          organizationId: context.organizationId,
          sourceResourceId: input.sourceResourceId,
          targetResourceId: input.targetResourceId,
          linkType: input.linkType,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  delete: orgMemberProcedure
    .input(
      z.object({
        linkId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await resourceLinkService.deleteResourceLink(input.linkId, context.organizationId);
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
