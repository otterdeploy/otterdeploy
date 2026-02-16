import { db, eq, and } from "@otterstack/db";
import { member, invitation } from "@otterstack/db/schema/auth";

import { DomainError } from "./errors";

export async function listMembers(organizationId: string) {
  const members = await db.query.member.findMany({
    where: eq(member.organizationId, organizationId),
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
}

export async function inviteMember(params: {
  organizationId: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  invitedBy: string;
}) {
  const existing = await db.query.invitation.findFirst({
    where: and(
      eq(invitation.organizationId, params.organizationId),
      eq(invitation.email, params.email),
      eq(invitation.status, "pending"),
    ),
  });

  if (existing) {
    throw new DomainError("CONFLICT", "Pending invitation already exists for this email");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    email: params.email,
    role: params.role,
    status: "pending",
    expiresAt,
    inviterId: params.invitedBy,
    createdAt: now,
  };

  await db.insert(invitation).values(row);

  return {
    invitationId: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: params.role,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function updateMemberRole(params: {
  organizationId: string;
  memberId: string;
  role: "owner" | "admin" | "member" | "viewer";
}) {
  const memberRow = await db.query.member.findFirst({
    where: and(
      eq(member.id, params.memberId),
      eq(member.organizationId, params.organizationId),
    ),
    with: { user: true },
  });

  if (!memberRow) {
    throw new DomainError("NOT_FOUND", "Member not found");
  }

  await db
    .update(member)
    .set({ role: params.role })
    .where(eq(member.id, params.memberId));

  return {
    memberId: memberRow.id,
    userId: memberRow.userId,
    organizationId: memberRow.organizationId,
    role: params.role,
    email: memberRow.user.email,
    name: memberRow.user.name ?? null,
    twoFactorEnabled: memberRow.user.twoFactorEnabled ?? false,
    joinedAt: memberRow.createdAt.toISOString(),
  };
}

export async function removeMember(params: {
  organizationId: string;
  memberId: string;
}) {
  const memberRow = await db.query.member.findFirst({
    where: and(
      eq(member.id, params.memberId),
      eq(member.organizationId, params.organizationId),
    ),
  });

  if (!memberRow) {
    throw new DomainError("NOT_FOUND", "Member not found");
  }

  if (memberRow.role === "owner") {
    throw new DomainError("FORBIDDEN", "Cannot remove the organization owner");
  }

  await db.delete(member).where(eq(member.id, params.memberId));
  return { success: true as const };
}
