/**
 * The public identity-provider directory: what the unauthenticated sign-in
 * page needs in order to render a "Continue with Okta" BUTTON.
 *
 * This exists because the old entry point asked the visitor to type their work
 * email so the server could match its domain to a provider. That is the wrong
 * shape for a sign-in page. Every other federated method here is one click
 * ("Continue with GitHub"), and asking for an address before the redirect
 * makes SSO look like a second password form. The IdP is the thing that
 * establishes identity; we should not be interviewing the user first.
 *
 * What is deliberately NOT returned: the issuer URL, the email domain, the
 * organization, and every part of the OIDC config. A visitor needs a label and
 * the handle that appears in the callback URL anyway; the rest is workspace
 * configuration and belongs to the admin-authorized settings endpoint.
 *
 * Whether this is served at all is the operator's call: `signInSsoEnabled` off
 * means the sign-in page gets an empty list AND the callback paths are gated
 * (see ./sign-in-methods.ts), so the buttons cannot be conjured back by an
 * SPA that skipped the config fetch.
 */

import { db } from "@otterdeploy/db";
import { ssoProvider } from "@otterdeploy/db/schema/auth";
import { asc } from "drizzle-orm";
import { log } from "evlog";

/**
 * Enough providers for any real self-hosted install, and a bound so a table
 * someone has scripted a thousand rows into cannot turn the sign-in page into
 * a thousand buttons.
 */
const MAX_PUBLIC_PROVIDERS = 20;

export interface PublicSsoProvider {
  /** The handle in `/sso/callback/:providerId`; already public by construction. */
  providerId: string;
  /** What the button says. */
  label: string;
}

/**
 * Human-readable name for a provider handle.
 *
 * `providerId` is constrained to `[a-z0-9][a-z0-9-]*` by the registration form,
 * so "acme-okta" becomes "Acme Okta". Derived rather than stored because a
 * display-name column would be a second thing for an operator to get wrong,
 * and the handle is already chosen with the redirect URI in mind. If a real
 * label is ever wanted, this is the one place that changes.
 */
export function providerLabel(providerId: string): string {
  const words = providerId
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return words.length > 0 ? words.join(" ") : providerId;
}

/**
 * Identity providers to advertise on the sign-in page, oldest first so the
 * button order is stable across page loads.
 *
 * Never throws: a database blip yields an empty list, so the page renders the
 * remaining methods instead of failing to render at all.
 */
export async function listPublicSsoProviders(): Promise<PublicSsoProvider[]> {
  try {
    const rows = await db
      .select({ providerId: ssoProvider.providerId })
      .from(ssoProvider)
      .orderBy(asc(ssoProvider.createdAt))
      .limit(MAX_PUBLIC_PROVIDERS);
    return rows.map((row) => ({
      providerId: row.providerId,
      label: providerLabel(row.providerId),
    }));
  } catch (error) {
    log.warn({
      auth: { event: "public-sso-directory-read-failed" },
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
