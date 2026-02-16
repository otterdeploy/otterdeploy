import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { db, eq, and } from "@otterstack/db";
import { member, invitation } from "@otterstack/db/schema/auth";

import {
  orgProcedure,
  orgAdminProcedure,
  orgOwnerProcedure,
} from "../index";
import { createId } from "../utils/helpers";

export const teamRouter = {
  listMembers: orgProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      }),
    )
    .handler(async ({ context }) => {
      const members = await db.query.member.findMany({
        where: eq(member.organizationId, context.organizationId),
        with: { user: true },
      });

      return members.map((m) => ({
        memberId: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        role: m.role as "owner" | "admin" | "member" | "viewer",
        email: m.user.email,
        name: m.user.name ?? null,
        twoFactorEnabled: m.user.twoFactorEnabled ?? false,
        joinedAt: m.createdAt.toISOString(),
      }));
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
      const existing = await db.query.invitation.findFirst({
        where: and(
          eq(invitation.organizationId, context.organizationId),
          eq(invitation.email, input.email),
          eq(invitation.status, "pending"),
        ),
      });

      if (existing) {
        throw new ORPCError("CONFLICT", { message: "Pending invitation already exists for this email" });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const row = {
        id: createId(),
        organizationId: context.organizationId,
        email: input.email,
        role: input.role,
        status: "pending",
        expiresAt,
        inviterId: context.userId,
        createdAt: now,
      };

      await db.insert(invitation).values(row);

      return {
        invitationId: row.id,
        organizationId: row.organizationId,
        email: row.email,
        role: input.role as "owner" | "admin" | "member" | "viewer",
        expiresAt: expiresAt.toISOString(),
      };
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
      const memberRow = await db.query.member.findFirst({
        where: and(
          eq(member.id, input.memberId),
          eq(member.organizationId, context.organizationId),
        ),
        with: { user: true },
      });

      if (!memberRow) {
        throw new ORPCError("NOT_FOUND", { message: "Member not found" });
      }

      await db
        .update(member)
        .set({ role: input.role })
        .where(eq(member.id, input.memberId));

      return {
        memberId: memberRow.id,
        userId: memberRow.userId,
        organizationId: memberRow.organizationId,
        role: input.role,
        email: memberRow.user.email,
        name: memberRow.user.name ?? null,
        twoFactorEnabled: memberRow.user.twoFactorEnabled ?? false,
        joinedAt: memberRow.createdAt.toISOString(),
      };
    }),

  removeMember: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        memberId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const memberRow = await db.query.member.findFirst({
        where: and(
          eq(member.id, input.memberId),
          eq(member.organizationId, context.organizationId),
        ),
      });

      if (!memberRow) {
        throw new ORPCError("NOT_FOUND", { message: "Member not found" });
      }

      if (memberRow.role === "owner") {
        throw new ORPCError("FORBIDDEN", { message: "Cannot remove the organization owner" });
      }

      await db.delete(member).where(eq(member.id, input.memberId));
      return { success: true as const };
    }),
};
