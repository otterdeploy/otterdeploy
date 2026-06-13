/**
 * Team (organization membership) data hooks. Thin TanStack Query wrappers
 * over better-auth's organization client so the Team page can list members
 * and pending invitations and invalidate them after mutations. The viewed
 * org id is always passed explicitly (the URL slug, not the session's
 * active org) so viewing another org's Team page shows the right roster.
 */

import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  image?: string | null;
  role: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
}

export const teamKeys = {
  members: (orgId: string) => ["org", orgId, "members"] as const,
  invitations: (orgId: string) => ["org", orgId, "invitations"] as const,
};

/** The browser URL an invitee opens to accept — same path the emailed link
 *  points at. Lets admins copy/share it manually when email isn't delivered
 *  (placeholder RESEND_API_KEY in dev, or just sharing via Slack). */
export function acceptInviteUrl(invitationId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/accept-invite/${invitationId}`;
}

export function useMembers(organizationId: string) {
  return useQuery({
    queryKey: teamKeys.members(organizationId),
    queryFn: async (): Promise<TeamMember[]> => {
      const res = await authClient.organization.listMembers({
        query: { organizationId },
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load members");
      }
      return (res.data?.members ?? []).map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user?.name ?? m.user?.email ?? "Unknown",
        email: m.user?.email ?? "",
        image: m.user?.image,
        role: m.role,
      }));
    },
  });
}

export function useInvitations(organizationId: string) {
  return useQuery({
    queryKey: teamKeys.invitations(organizationId),
    queryFn: async (): Promise<PendingInvite[]> => {
      const res = await authClient.organization.listInvitations({
        query: { organizationId },
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load invitations");
      }
      return (res.data ?? [])
        .filter((i) => i.status === "pending")
        .map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: new Date(i.expiresAt),
        }));
    },
  });
}
