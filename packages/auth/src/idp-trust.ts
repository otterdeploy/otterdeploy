/**
 * Letting an operator point this install at any identity provider they like,
 * without handing that power to a web page they happen to be visiting.
 *
 * ## The problem
 *
 * `@better-auth/sso` validates every OIDC URL it is about to fetch — the
 * discovery endpoint, and then each endpoint the discovery document names —
 * against better-auth's `trustedOrigins`:
 *
 *     if (!isTrustedOrigin(discoveryEndpoint))
 *       throw new DiscoveryError("discovery_untrusted_origin", …)
 *
 * But `trustedOrigins` is the BROWSER origin list: it is what the CSRF and
 * callbackURL checks compare the `Origin` header against. Ours is the
 * dashboard's own origins (`CORS_ORIGIN`), which is correct for CSRF and
 * useless here — an external IdP is never in it and never should be. The two
 * meanings are conflated, and the practical result was that registering ANY
 * external identity provider failed with "not trusted by your trusted origins
 * configuration". The SSO feature could not be used at all.
 *
 * Trusting only the issuer the admin typed is not enough either: a discovery
 * document may legitimately name endpoints on a different host (Google's
 * issuer is `accounts.google.com` while its `jwks_uri` is on
 * `www.googleapis.com`), and those are validated by the same predicate.
 *
 * ## Why not simply widen `trustedOrigins`
 *
 * Because the CSRF check reads the same list. Adding an attacker-supplied
 * origin — or a blanket wildcard — for every request would mean a page at
 * `evil.com` could POST to `/sso/register` with the operator's cookies (ours
 * are `SameSite=None` over HTTPS, so they are sent cross-site), have its own
 * origin accepted, and register an IdP that then authenticates as anybody at
 * the domain it claims. That is a full account-takeover path, not a
 * theoretical one.
 *
 * ## What this does instead
 *
 * Widen the list to "any https origin" ONLY for the handful of paths that
 * actually fetch an IdP, and only once the request has ALREADY been shown to
 * come from somewhere we trust. The same-origin test happens here, before the
 * widening, so the widened list can never be what let the request through:
 *
 *   - `Origin` present and one of ours → a real dashboard request. Widen.
 *   - `Origin` absent → not a browser (CLI, bearer token) or a top-level
 *     redirect back from the IdP. A browser cannot omit `Origin` on a
 *     cross-origin POST, so this is not a CSRF vector; the caller already
 *     holds a credential. Widen.
 *   - `Origin` present and NOT ours → exactly the attack above. Do not widen,
 *     and better-auth's own origin check then rejects the request.
 *
 * What stays enforced: the plugin's separate private-host check
 * (`discovery_private_host`) still refuses endpoints that resolve to internal
 * addresses, so this cannot be turned into an SSRF probe of the private
 * network. And `https://*` deliberately does not match plain `http://`, so a
 * cleartext internal target is out of reach as well.
 */

/**
 * Matches any https origin. Verified against better-auth's own
 * `matchesOriginPattern`: a pattern containing `*` and `://` is compared to
 * the URL's ORIGIN, so this admits `https://idp.example.com` and
 * `https://www.googleapis.com` while rejecting `http://127.0.0.1:8080`.
 */
export const ANY_HTTPS_ORIGIN = "https://*";

/**
 * Better Auth route paths (relative to the mount point) that cause the server
 * to fetch a URL belonging to an identity provider.
 *
 * `register` / `update-provider` take the issuer from the admin's request
 * body. `sign-in/sso` and `callback` take it from a provider row an admin
 * already registered, and reach discovery through `ensureRuntimeDiscovery`
 * whenever the stored config is missing an endpoint — so leaving them out
 * would let a provider register successfully and then fail at sign-in.
 *
 * Everything else in the plugin (`providers`, `get-provider`,
 * `delete-provider`, the domain-verification pair) only touches our own
 * database and must not widen anything.
 */
const IDP_DISCOVERY_PATHS = [
  "/sso/register",
  "/sso/update-provider",
  "/sign-in/sso",
  "/sso/callback",
] as const;

function isIdpDiscoveryPath(path: string): boolean {
  return IDP_DISCOVERY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * May this request reach an arbitrary external identity provider?
 *
 * `trusted` is the list as it stands BEFORE any widening — the dashboard's own
 * origins. Passing it in rather than recomputing keeps the same-origin test
 * and the CSRF list provably identical.
 */
export function mayReachExternalIdp(input: {
  /** Request path, relative to the better-auth mount point. */
  path: string;
  /** The request's `Origin` header, or null when it has none. */
  origin: string | null;
  /** Origins already trusted for this request. */
  trusted: readonly string[];
}): boolean {
  if (!isIdpDiscoveryPath(input.path)) return false;
  // A browser cannot suppress `Origin` on a cross-origin POST, so its absence
  // means this is not a cross-site request from a page.
  if (input.origin === null || input.origin === "null") return true;
  return input.trusted.includes(input.origin);
}
