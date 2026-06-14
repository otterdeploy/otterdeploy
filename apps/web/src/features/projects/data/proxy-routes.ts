import { createCollection } from "@tanstack/db";
import {
  parseLoadSubsetOptions,
  queryCollectionOptions,
} from "@tanstack/query-db-collection";

import { zId, type ProxyRouteId } from "@otterdeploy/shared/id";

import { parseCol, projectIdSchema } from "@/shared/lib/utils";

import { orpc, queryClient } from "@/shared/server/orpc";

const routeIdSchema = zId("proxy_route");

/**
 * Caddy proxy routes for the active project, sourced from
 * `project.proxyRoute.list`. One row per published HTTP / layer-4 route the
 * reconciler maintains.
 *
 * Routes themselves are reconciler-owned (no create/delete from the client) —
 * the only user-settable fields are `protected` (the auth wall) and
 * `customDirectives`. Both ride `onUpdate`, dispatching to the matching oRPC
 * procedure on whichever field changed, so the protection switch and the
 * directives dialog mutate the collection instead of holding their own
 * mutations. The Networking tab reads via a live query.
 *
 * Single shared collection rather than one-per-project: consumers scope it by
 * adding `eq(r.projectId, …)` to their live query. TanStack DB forwards that
 * filter as `loadSubsetOptions`, from which `queryKey` / `queryFn` recover the
 * `projectId` to fetch (and cache) the right subset.
 *
 * `setRouteDirectives` is validate-before-save: Caddy can reject the directives
 * (`applied: false`), in which case `onUpdate` throws so the optimistic row
 * rolls back and the caller can surface the inline parse error from the
 * rejection.
 */
export class RouteDirectivesRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteDirectivesRejectedError";
  }
}

export const proxyRoutesCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["proxyRoutes"];
      const { filters } = parseLoadSubsetOptions(opts);
      // Startup base-key call: query-db-collection calls queryKey({}) once to
      // compute the prefix every subset key must extend. No filters yet.
      if (!filters.at(0)) return baseQuery;
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      const subsetKey = orpc.project.proxyRoute.list.queryKey({
        input: { projectId },
      });
      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const projectId = parseCol(projectIdSchema, filters, "projectId");
      return orpc.project.proxyRoute.list.call({ projectId });
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const routeId = m.original.id as ProxyRouteId;
          // The auth-wall toggle.
          if (m.changes.protected !== undefined) {
            await orpc.project.proxyRoute.setProtection.call({
              routeId,
              protected: m.changes.protected,
            });
          }
          // Per-route custom directives. Validate-before-save: a Caddy parse
          // rejection comes back as `applied: false` — throw so the optimistic
          // row rolls back and the dialog renders the inline error.
          if (m.changes.customDirectives !== undefined) {
            const directives = m.changes.customDirectives;
            const result = await orpc.project.proxyRoute.setRouteDirectives.call({
              routeId,
              directives:
                directives && directives.trim().length > 0 ? directives : null,
            });
            if (!result.applied) {
              throw new RouteDirectivesRejectedError(
                result.error ?? "Caddy rejected these directives",
              );
            }
          }
        }),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);

/**
 * External guests invited to a single protected route (Cloudflare-Access-style
 * email + one-time code). Sourced from `project.proxyRoute.listGuests`, scoped
 * by `eq(g.routeId, …)`. Insert → inviteGuest, delete → removeGuest; the add /
 * remove rows are optimistic, so the form drops its own pending flag. The
 * server list omits `routeId` (it's the path param) — we stamp it back on each
 * row so the client-side `eq` filter matches.
 */
export const routeGuestsCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: (opts) => {
      const baseQuery = ["routeGuests"];
      const { filters } = parseLoadSubsetOptions(opts);
      if (!filters.at(0)) return baseQuery;
      const routeId = parseCol(routeIdSchema, filters, "routeId");
      const subsetKey = orpc.project.proxyRoute.listGuests.queryKey({
        input: { routeId },
      });
      return [...baseQuery, ...subsetKey];
    },
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions);
      if (!filters.at(0)) return [];
      const routeId = parseCol(routeIdSchema, filters, "routeId");
      const guests = await orpc.project.proxyRoute.listGuests.call({ routeId });
      return guests.map((g) => ({ ...g, routeId }));
    },
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (m) => {
          const row = m.modified;
          await orpc.project.proxyRoute.inviteGuest.call({
            routeId: row.routeId as ProxyRouteId,
            email: row.email,
            sessionHours: row.sessionHours,
          });
          // The optimistic row used a temp id; refetch so the server row (real
          // id, normalized email) replaces it.
          void queryClient.invalidateQueries({
            queryKey: orpc.project.proxyRoute.listGuests.queryKey({
              input: { routeId: row.routeId as ProxyRouteId },
            }),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          orpc.project.proxyRoute.removeGuest.call({
            routeId: m.original.routeId as ProxyRouteId,
            guestId: m.original.id,
          }),
        ),
      );
    },
    queryClient,
    getKey: (item) => item.id,
  }),
);
