/**
 * SSO provider reads, scoped to the caller's ACTIVE organization.
 *
 * Writes (register/update/delete) deliberately still go straight to
 * better-auth's own `/sso/*` endpoints from the client — they are single-object
 * operations the plugin already authorizes per provider (`checkProviderAccess`
 * → `isOrgAdmin`), so wrapping them would add a second authorization path to
 * keep correct for no gain.
 *
 * The LIST is different, and is why this router exists. The plugin's
 * `/sso/providers` returns every provider the caller can administer across ALL
 * their organizations. That is correctly authorized — no other tenant's config
 * is reachable — but a workspace settings page has no business receiving a
 * different workspace's identity-provider metadata, and a `.filter()` in the
 * browser is presentation, never a boundary. This narrows on the server so the
 * extra rows never cross the wire.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { organizationIdField } from "../project/contract/shared";

/**
 * Mirrors the plugin's already-redacted view. Note what is ABSENT and must stay
 * absent: `clientSecret`, and the full `clientId` (only its last four
 * characters are exposed). The raw `sso_provider.oidc_config` column is never
 * read into this shape — see packages/db/src/schema/auth.ts.
 */
export const ssoProviderViewSchema = z.object({
  providerId: z.string(),
  issuer: z.string(),
  domain: z.string(),
  organizationId: organizationIdField.nullable(),
  oidcConfig: z
    .object({
      clientIdLastFour: z.string(),
      discoveryEndpoint: z.string(),
    })
    .nullable(),
});

export const ssoContract = {
  /** Identity providers registered for the caller's active workspace. */
  listProviders: oc
    .meta({
      path: "/sso/providers",
      tag: "sso",
      method: "GET",
    })
    .input(z.object({}))
    .output(z.object({ providers: z.array(ssoProviderViewSchema) })),
};

export type SsoProviderView = z.infer<typeof ssoProviderViewSchema>;
