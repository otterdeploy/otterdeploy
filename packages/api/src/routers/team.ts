import * as z from "zod";
import { teamService } from "@otterstack/domain";

import { orgProcedure, orgAdminProcedure, orgOwnerProcedure } from "../index";
import { unwrapResult } from "../utils/result";

export const teamRouter = {
  listMembers: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      }),
    )
    .handler(async ({ context }) => {
      return teamService.listMembers(context.organizationId);
    }),

  invite: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        email: z.email(),
        role: z.enum(["owner", "admin", "member", "viewer"]),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await teamService.inviteMember({
          organizationId: context.organizationId,
          email: input.email,
          role: input.role,
          invitedBy: context.userId,
        }),
      );
    }),

  updateRole: orgOwnerProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
        role: z.enum(["owner", "admin", "member", "viewer"]),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await teamService.updateMemberRole({
          organizationId: context.organizationId,
          memberId: input.memberId,
          role: input.role,
        }),
      );
    }),

  removeMember: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await teamService.removeMember({
          organizationId: context.organizationId,
          memberId: input.memberId,
        }),
      );
    }),
};
