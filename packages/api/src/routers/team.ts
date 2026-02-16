import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { teamService, DomainError } from "@otterstack/domain";

import {
  orgProcedure,
  orgAdminProcedure,
  orgOwnerProcedure,
} from "../index";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

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
      try {
        return await teamService.inviteMember({
          organizationId: context.organizationId,
          email: input.email,
          role: input.role,
          invitedBy: context.userId,
        });
      } catch (err) {
        mapDomainError(err);
      }
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
      try {
        return await teamService.updateMemberRole({
          organizationId: context.organizationId,
          memberId: input.memberId,
          role: input.role,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  removeMember: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await teamService.removeMember({
          organizationId: context.organizationId,
          memberId: input.memberId,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
