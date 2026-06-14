/**
 * Team (organization membership) data, modelled as two org-scoped, authClient-
 * backed TanStack DB collections — same shape as `apiKeysCollection`. Members and
 * invitations both ride better-auth's organization client
 * (`authClient.organization.*`); list/remove/cancel/invite are wired as the
 * collections' own handlers so consumers just read via a live query and mutate
 * the collection.
 *
 * One shared collection per concern rather than one-per-org: consumers scope by
 * adding `eq(row.organizationId, …)` to their live query. TanStack DB forwards
 * that filter as `loadSubsetOptions`, from which `queryKey` / `queryFn` recover
 * the `organizationId` to fetch (and cache) the right subset. The plugin's list
 * is already filtered server-side by that id; we stamp it back onto each row so
 * the client-side `eq` matches. Row (and insert) types are inferred from the
 * `queryFn` projections — never hand-written.
 *
 * `useMembers` / `useInvitations` remain exported as thin `useLiveQuery`
 * wrappers (returning `{ data, isLoading }`) so existing consumers compile
 * unchanged; the viewed org id is always passed explicitly (the URL slug, not
 * the session's active org).
 */

import { createCollection } from "@tanstack/db";
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from "@tanstack/query-db-collection";
import { eq, useLiveQuery } from "@tanstack/react-db";

import { z } from "zod";

import { parseCol } from "@/shared/lib/utils";

import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/shared/server/orpc";

const organizationIdSchema = z.string().min(1);

/** React-query key for one org's members subset. */
export function membersSubsetKey(organizationId: string) {
  return ["org", organizationId, "members"] as const;
}

/** React-query key for one org's invitations subset. */
export function invitationsSubsetKey(organizationId: string) {
  return ["org", organizationId, "invitations"] as const;
}

/** The browser URL an invitee opens to accept — same path the emailed link
 *  points at. Lets admins copy/share it manually when email isn't delivered
 *  (placeholder RESEND_API_KEY in dev, or just sharing via Slack). */
export function acceptInviteUrl(invitationId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/accept-invite/${invitationId}`;
}

export const membersCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["org", "members"];
      const { filters } = parseLoadSubsetOptions(opts);
      if (!filters.at(0)) return baseQuery;
      const organizationId = parseCol(
        organizationIdSchema,
        filters,
        "organizationId",
      );
      return [...membersSubsetKey(organizationId)];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const organizationId = parseCol(
        organizationIdSchema,
        filters,
        "organizationId",
      );
      const res = await authClient.organization.listMembers({
        query: { organizationId },
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load members");
      }
      // Project to the fields the UI renders + the (server-filtered) org id
      // stamped back on so the live-query filter matches client-side.
      return (res.data?.members ?? []).map((m) => ({
        id: m.id,
        organizationId,
        userId: m.userId,
        name: m.user?.name ?? m.user?.email ?? "Unknown",
        email: m.user?.email ?? "",
        image: m.user?.image ?? null,
        role: m.role,
      }));
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const res = await authClient.organization.removeMember({
            memberIdOrEmail: m.original.id,
            organizationId: m.original.organizationId,
          });
          if (res.error) {
            throw new Error(res.error.message ?? "Failed to remove member");
          }
        }),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

export const invitationsCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["org", "invitations"];
      const { filters } = parseLoadSubsetOptions(opts);
      if (!filters.at(0)) return baseQuery;
      const organizationId = parseCol(
        organizationIdSchema,
        filters,
        "organizationId",
      );
      return [...invitationsSubsetKey(organizationId)];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const organizationId = parseCol(
        organizationIdSchema,
        filters,
        "organizationId",
      );
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
          organizationId,
          email: i.email,
          role: i.role,
          expiresAt: new Date(i.expiresAt),
        }));
    },
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          const res = await authClient.organization.inviteMember({
            email: row.email,
            role: row.role as "member" | "admin",
            organizationId: row.organizationId,
          });
          if (res.error) {
            throw new Error(res.error.message ?? "Failed to send invitation");
          }
          // The optimistic row used a temp id; refetch so the real row (server
          // id, resolved expiry) replaces it.
          void queryClient.invalidateQueries({
            queryKey: invitationsSubsetKey(row.organizationId),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const res = await authClient.organization.cancelInvitation({
            invitationId: m.original.id,
          });
          if (res.error) {
            throw new Error(res.error.message ?? "Failed to cancel invitation");
          }
        }),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

/** Row types inferred from the collections — never hand-written. */
export type TeamMember = (typeof membersCollection.toArray)[number];
export type PendingInvite = (typeof invitationsCollection.toArray)[number];

/** Thin live-query wrapper so existing consumers keep `{ data, isLoading }`. */
export function useMembers(organizationId: string) {
  return useLiveQuery(
    (q) =>
      q
        .from({ m: membersCollection })
        .where(({ m }) => eq(m.organizationId, organizationId)),
    [organizationId],
  );
}

/** Thin live-query wrapper so existing consumers keep `{ data, isLoading }`. */
export function useInvitations(organizationId: string) {
  return useLiveQuery(
    (q) =>
      q
        .from({ i: invitationsCollection })
        .where(({ i }) => eq(i.organizationId, organizationId)),
    [organizationId],
  );
}
