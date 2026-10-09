/**
 * The organization this tab's page belongs to, stated on every API call.
 *
 * The session's active organization is shared by every tab. When another tab
 * switches it, this tab still shows organization A while the session resolves
 * B. The page's organization is therefore sent with every call
 * (`x-otterdeploy-organization`), and the server refuses an org-scoped call
 * whose organization is no longer the session's active one (409
 * ORGANIZATION_SWITCHED) instead of acting in B. See
 * packages/api/src/authz/acting-organization.ts.
 *
 * Module state, not React state: it belongs to the tab, and the oRPC link reads
 * it per request. The `/_app/$orgSlug` route sets it before any page under it
 * loads; the org switcher moves it with the session.
 */
import { ACTING_ORGANIZATION_HEADER } from "@otterdeploy/api/authz/acting-organization";

let actingOrganizationId: string | null = null;

/** This tab now acts in `organizationId` (null: no stated organization). */
export function actInOrganization(organizationId: string | null): void {
  actingOrganizationId = organizationId;
}

/** The headers every oRPC call carries. */
export function actingOrganizationHeaders(): Record<string, string> {
  return actingOrganizationId ? { [ACTING_ORGANIZATION_HEADER]: actingOrganizationId } : {};
}
