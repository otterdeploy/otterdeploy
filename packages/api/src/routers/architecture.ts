import * as z from "zod";
import { architectureService } from "@otterstack/domain";

import { orgProcedure, orgMemberProcedure } from "../index";
import { unwrapResult } from "../utils/result";

export const architectureRouter = {
  getGraph: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await architectureService.getProjectGraph(
          input.projectId,
          context.organizationId,
          input.environmentId,
        ),
      );
    }),

  replaceGraph: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        resources: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string(),
            kind: z.enum(["web", "api", "worker", "database", "cache", "volume"]),
            status: z.enum(["online", "degraded", "crashed", "unknown", "deploying", "stopped"]),
            metadata: z.record(z.string(), z.unknown()),
            posX: z.number(),
            posY: z.number(),
          }),
        ),
        links: z.array(
          z.object({
            id: z.string().min(1),
            sourceResourceId: z.string().min(1),
            targetResourceId: z.string().min(1),
            linkType: z.enum(["depends_on", "network", "mounts"]),
          }),
        ),
        viewport: z.object({
          x: z.number(),
          y: z.number(),
          zoom: z.number(),
        }),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await architectureService.replaceProjectGraph({
          projectId: input.projectId,
          organizationId: context.organizationId,
          environmentId: input.environmentId,
          resources: input.resources,
          links: input.links,
          viewport: input.viewport,
        }),
      );
    }),

  updateViewport: orgProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        viewport: z.object({
          x: z.number(),
          y: z.number(),
          zoom: z.number(),
        }),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await architectureService.updateViewport({
          projectId: input.projectId,
          organizationId: context.organizationId,
          environmentId: input.environmentId,
          viewport: input.viewport,
        }),
      );
    }),
};
