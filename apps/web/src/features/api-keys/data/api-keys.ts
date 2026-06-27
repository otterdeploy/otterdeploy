import { createCollection } from "@tanstack/db";
import { parseLoadSubsetOptions, queryCollectionOptions } from "@tanstack/query-db-collection";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { parseCol } from "@/shared/lib/utils";
import { client, queryClient } from "@/shared/server/orpc";

/**
 * Org-scoped API keys for the viewed organization. List/update/delete ride the
 * better-auth apiKey client (`authClient.apiKey.*`, which the plugin owns);
 * create alone routes through the server (oRPC) because the plugin forbids
 * setting `permissions` from the browser. All four are wired as the collection's
 * own handlers, so the page just reads via a live query and mutates the
 * collection — no separate hooks.
 *
 * Single shared collection rather than one-per-org: consumers scope it by adding
 * `eq(k.organizationId, …)` to their live query. TanStack DB forwards that filter
 * as `loadSubsetOptions`, from which `queryKey` / `queryFn` recover the
 * `organizationId` to fetch (and cache) the right subset. The plugin's list is
 * already filtered server-side by that id; we stamp it back onto each row so the
 * client-side `eq` filter matches. `queryFn` projects the verbose plugin row down
 * to the fields the UI uses — the row type (and so the insert shape) is inferred
 * from that projection.
 */
const organizationIdSchema = z.string().min(1);

/** React-query key for one org's key subset. */
function apiKeysSubsetKey(organizationId: string) {
  return ["apiKeys", organizationId] as const;
}

export const apiKeysCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["apiKeys"];
      const { filters } = parseLoadSubsetOptions(opts);
      // Startup base-key call: query-db-collection calls queryKey({}) once to
      // compute the prefix every subset key must extend. No filters yet.
      if (!filters.at(0)) return baseQuery;
      const organizationId = parseCol(organizationIdSchema, filters, "organizationId");
      return [...apiKeysSubsetKey(organizationId)];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const organizationId = parseCol(organizationIdSchema, filters, "organizationId");
      const res = await authClient.apiKey.list({ query: { organizationId } });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load API keys");
      }
      // The plugin returns a paginated wrapper: `{ apiKeys, total, limit }`.
      // Project to just the fields the UI renders + the (server-filtered) org id
      // stamped back on so the live-query filter matches client-side.
      return (res.data?.apiKeys ?? []).map((k) => ({
        id: k.id,
        organizationId,
        name: k.name,
        start: k.start,
        prefix: k.prefix,
        enabled: k.enabled,
        expiresAt: k.expiresAt,
        lastRequest: k.lastRequest,
        createdAt: k.createdAt,
        permissions: k.permissions,
      }));
    },
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          // `create` wants seconds-until-expiry; the optimistic row holds the
          // resolved `expiresAt` — recover the delta.
          const expiresIn = row.expiresAt
            ? Math.round((new Date(row.expiresAt).getTime() - Date.now()) / 1000)
            : null;
          const created = await client.apiKeys.create({
            name: row.name ?? "",
            expiresIn,
            ...(row.permissions && Object.keys(row.permissions).length > 0
              ? { permissions: row.permissions }
              : {}),
          });
          // Hand the one-time plaintext token to the UI before we resolve; it's
          // never stored on the row. (Metadata is `unknown` at this boundary.)
          (m.metadata as { onKey: (key: string) => void }).onKey(created.key);
          // The optimistic row used a temp id; refetch so the real row (server
          // id, masked `start`, …) replaces it.
          void queryClient.invalidateQueries({
            queryKey: apiKeysSubsetKey(row.organizationId),
          });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          // The enable toggle is the only user-settable field.
          if (m.changes.enabled === undefined) return;
          const res = await authClient.apiKey.update({
            keyId: m.original.id,
            enabled: m.changes.enabled,
          });
          if (res.error) {
            throw new Error(res.error.message ?? "Failed to update API key");
          }
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const res = await authClient.apiKey.delete({ keyId: m.original.id });
          if (res.error) {
            throw new Error(res.error.message ?? "Failed to delete API key");
          }
        }),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);
