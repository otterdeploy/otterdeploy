import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq } from "@otterstack/db";
import { projectResourceLink } from "@otterstack/db/schema/architecture";

import { orgMemberProcedure } from "../index";
import { createId } from "../utils/helpers";
import {
  validateEnvironmentInProject,
  validateResourceAccess,
  validateResourceLinkAccess,
} from "../utils/ownership";

function formatLink(
  row: typeof projectResourceLink.$inferSelect,
  projectId: string,
) {
  return {
    id: row.id,
    projectId,
    environmentId: row.environmentId,
    sourceResourceId: row.sourceResourceId,
    targetResourceId: row.targetResourceId,
    linkType: row.linkType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
      await validateEnvironmentInProject(input.environmentId, input.projectId, context.organizationId);

      const [source, target] = await Promise.all([
        validateResourceAccess(input.sourceResourceId, context.organizationId),
        validateResourceAccess(input.targetResourceId, context.organizationId),
      ]);

      if (source.environmentId !== input.environmentId || target.environmentId !== input.environmentId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Resources must belong to the specified environment",
        });
      }

      const now = new Date();
      const link = {
        id: createId(),
        environmentId: input.environmentId,
        sourceResourceId: input.sourceResourceId,
        targetResourceId: input.targetResourceId,
        linkType: input.linkType ?? ("network" as const),
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(projectResourceLink).values(link);
      return formatLink(link as typeof projectResourceLink.$inferSelect, input.projectId);
    }),

  delete: orgMemberProcedure
    .input(
      z.object({
        linkId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateResourceLinkAccess(input.linkId, context.organizationId);
      await db.delete(projectResourceLink).where(eq(projectResourceLink.id, input.linkId));
      return { success: true as const };
    }),
};
