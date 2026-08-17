import { timingSafeEqual } from "node:crypto";

export const BOOTSTRAP_TOKEN_HEADER = "x-otterdeploy-bootstrap-token";

/**
 * Better Auth endpoint paths that mean "this account is being created by an
 * identity provider we trust", as opposed to someone typing an email into a
 * form. Only the SSO plugin's own callbacks qualify.
 *
 * This is half of the SSO admission gate and it is the load-bearing half. The
 * other half ("a provider is registered for this email's domain") is NOT
 * sufficient on its own: once an operator registers `acme.com`, admitting any
 * `@acme.com` signup regardless of path would let anyone self-register through
 * `/sign-up/email` simply by claiming an address at an SSO'd domain, never
 * touching the IdP. Both conditions must hold.
 */
export function isSsoCallbackPath(path: string | undefined): boolean {
  if (!path) return false;
  // `/sso/callback/:providerId` and the shared `/sso/callback`; the saml2
  // variants are matched too so enabling SAML later does not silently fall
  // through to `invite-required`.
  return path.startsWith("/sso/callback") || path.startsWith("/sso/saml2/");
}

export type RegistrationDecision =
  | { allowed: true; installAdmin: boolean }
  | {
      allowed: false;
      reason: "bootstrap-token-missing" | "bootstrap-token-invalid" | "invite-required";
    };

function equalToken(presented: string, expected: string): boolean {
  const actualBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Pure admission policy shared by the Better Auth hook and its hostile-path
 * tests. The initial account is email/password-only because an OAuth callback
 * cannot safely carry the one-time bootstrap credential across the provider.
 */
export function decideRegistration(input: {
  bootstrapComplete: boolean;
  hasPendingInvitation: boolean;
  authPath: string | undefined;
  configuredBootstrapToken: string | undefined;
  presentedBootstrapToken: string | undefined;
  /**
   * Operator opt-in (Instance → Access) letting anyone who can reach the
   * sign-in page create an account, instead of requiring an invitation.
   *
   * Optional, defaulting to FALSE, so the safe policy is what a caller that
   * forgets to thread it through gets. It is deliberately consulted only in
   * the post-bootstrap branch: open registration can never satisfy the first
   * account (that still needs the installer's token) and never grants
   * install-admin: otherwise flipping one switch would hand the next visitor
   * authority over the whole install.
   */
  openRegistration?: boolean;
  /**
   * True when an org-scoped SSO provider is registered for this email address's
   * domain AND the account is being created by that provider's callback (see
   * {@link isSsoCallbackPath}: the caller must require both).
   *
   * This is the third way to be admitted after bootstrap, alongside an
   * invitation and open registration, and it exists because SSO is otherwise
   * unusable: an operator who wires `acme.com` to their Okta tenant means
   * "people from this tenant may sign in", and requiring an individual
   * invitation on top of that defeats the entire feature.
   *
   * Like open registration it never grants install-admin. Optional and
   * defaulting to FALSE so a caller that forgets to thread it through gets the
   * closed policy, matching `openRegistration` above.
   */
  ssoProviderVouches?: boolean;
}): RegistrationDecision {
  if (input.bootstrapComplete) {
    if (input.hasPendingInvitation) return { allowed: true, installAdmin: false };
    if (input.ssoProviderVouches) return { allowed: true, installAdmin: false };
    return input.openRegistration
      ? { allowed: true, installAdmin: false }
      : { allowed: false, reason: "invite-required" };
  }

  const expected = input.configuredBootstrapToken;
  const presented = input.presentedBootstrapToken;
  if (!expected || !presented || input.authPath !== "/sign-up/email") {
    return { allowed: false, reason: "bootstrap-token-missing" };
  }
  if (!equalToken(presented, expected)) {
    return { allowed: false, reason: "bootstrap-token-invalid" };
  }
  return { allowed: true, installAdmin: true };
}
