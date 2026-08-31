/**
 * Org-scoped event bus wire contract. Shared between the API process (which
 * serves `events.orgStream`) and the jobs workers (which publish from paths
 * like the notification-inbox writer, and must not depend on the api package).
 *
 * Two shapes, and the difference is the one
 * docs/designs/collection-cache-invalidation-api.md draws:
 *
 *   - **resync** events are payload-free. A kind names which org-wide surface
 *     changed and consumers refetch through their own query. This is right for
 *     surfaces whose rows are large, derived, or expensive to serialise.
 *
 *   - **row** events carry the row itself, and the client applies it with
 *     `writeUpsert`/`writeDelete` — no refetch at all. A collection qualifies
 *     when its rows are small, its authorization is uniform across the org, and
 *     a stale list is actively misleading rather than merely late.
 *
 * `data-connections` qualifies on all three: a handful of rows, org-visible by
 * definition (private ones are filtered server-side and never published), and a
 * connection switcher that silently omits what a teammate just added is a list
 * that is wrong rather than slow.
 */

/** Surfaces that resync: the event names them, the client refetches. */
export const ORG_STREAM_COLLECTIONS = ["activity", "inbox", "servers"] as const;

export type OrgStreamCollection = (typeof ORG_STREAM_COLLECTIONS)[number];

/** Collections whose rows are pushed, applied without a refetch. */
export const ORG_ROW_COLLECTIONS = ["data-connections"] as const;

export type OrgRowCollection = (typeof ORG_ROW_COLLECTIONS)[number];

/**
 * A connection row as it travels the bus.
 *
 * Structurally identical to what `data.listConnections` returns, and for the
 * same reason: it is everything a client needs to identify the connection and
 * NOTHING that could open it. The encrypted URL is not here, is not on the
 * list procedure, and must never be added to either.
 */
export interface OrgConnectionRow {
  id: string;
  name: string;
  engine: "postgres" | "mariadb";
  displayHost: string;
  displayDatabase: string;
  visibility: "org" | "private";
  environment: "production" | "other";
  defaultAccess: "read-only" | "read-write";
  requireTls: boolean;
  createdAt: string;
  lastConnectedAt: string | null;
}

export type OrgBusEvent =
  | { kind: OrgStreamCollection }
  | { kind: OrgRowCollection; op: "upsert"; rows: OrgConnectionRow[] }
  | { kind: OrgRowCollection; op: "delete"; keys: string[] };

/** Redis pub/sub channel for one organization's event fan-out. */
export function orgEventsChannel(organizationId: string): string {
  return `org:${organizationId}:events`;
}
