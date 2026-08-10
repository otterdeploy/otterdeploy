/**
 * Org-scoped event bus wire contract. Shared between the API process (which
 * serves `events.orgStream`) and the jobs workers (which publish from paths
 * like the notification-inbox writer, and must not depend on the api package).
 *
 * The payload is deliberately payload-free: a kind names which org-wide
 * surface changed, consumers refetch through their own query. Rows are never
 * pushed here. See docs/designs/collection-cache-invalidation-api.md for
 * what qualifies a collection for pushed rows.
 */

export const ORG_STREAM_COLLECTIONS = ["activity", "inbox", "servers"] as const;

export type OrgStreamCollection = (typeof ORG_STREAM_COLLECTIONS)[number];

export interface OrgBusEvent {
  kind: OrgStreamCollection;
}

/** Redis pub/sub channel for one organization's event fan-out. */
export function orgEventsChannel(organizationId: string): string {
  return `org:${organizationId}:events`;
}
