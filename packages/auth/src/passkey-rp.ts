/**
 * The relying party a passkey ceremony runs for: the host the browser is on.
 *
 * ## The bug
 *
 * `@better-auth/passkey` computes the WebAuthn `rpID` as
 * `new URL(ctx.context.options.baseURL).hostname` — the install's configured
 * `BETTER_AUTH_URL`, fixed at boot. A self-hosted box is reachable at many
 * names (its IP, a LAN name, `localhost` through an SSH tunnel, a domain added
 * later), and WebAuthn only accepts an rpID that is the page's own host or a
 * registrable suffix of it. So a default install (`BETTER_AUTH_URL` =
 * `http://<ip>:3000`) handed every browser `rp.id = <ip>`: on the IP itself
 * WebAuthn is unavailable (not a secure context), and on every secure origin
 * the browser refused the IP. No passkey could ever be added.
 *
 * ## The fix
 *
 * For the four ceremony endpoints only, the request's own context gets a
 * `baseURL` on the host the request reached (the `Host` header, the same
 * signal the same-origin `trustedOrigins` rule already trusts). The plugin
 * then issues and verifies against that host.
 *
 * ## Why trusting `Host` here is safe
 *
 * The rpID is not an access-control input: the authenticator signs its hash
 * and the browser only ever produces a credential for the page's own host. A
 * request that lies about `Host` gets options for a host whose credentials
 * live nowhere but on that host, and a verification whose expected rpID no
 * genuine assertion for this install can match. A phishing page cannot ask
 * the browser for our credentials either way. That is WebAuthn's origin
 * binding, not ours to re-enforce.
 *
 * The context is replaced on THIS request's copy only (better-auth spreads a
 * fresh `context` per dispatch), never on the shared options object.
 */
import { Result } from "better-result";

/** The endpoints that read the rpID: register and authenticate, options and verify. */
export const PASSKEY_CEREMONY_PATHS: ReadonlySet<string> = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
]);

/**
 * The base URL whose hostname is the request's host, or null when the request
 * names none (a direct `auth.api` call, a malformed header). Only the
 * hostname is read downstream, so the scheme is nominal.
 */
export function passkeyRelyingPartyBase(headers: Headers | undefined | null): string | null {
  const host = headers?.get("host")?.trim();
  if (!host) return null;
  return Result.try(() => new URL(`https://${host}`))
    .map((url) => (url.host === host.toLowerCase() ? url.origin : null))
    .unwrapOr(null);
}

/** The slice of an endpoint context this needs: its path, headers and auth context. */
export interface PasskeyCeremonyContext {
  path?: string;
  headers?: Headers;
  context: { options: { baseURL?: unknown } };
}

/**
 * Point a passkey ceremony at the host the browser is on. A no-op for every
 * other path and for a request without a usable `Host`.
 */
export function bindPasskeyRelyingParty(ctx: PasskeyCeremonyContext): void {
  if (!ctx.path || !PASSKEY_CEREMONY_PATHS.has(ctx.path)) return;
  const base = passkeyRelyingPartyBase(ctx.headers);
  if (!base) return;
  ctx.context.options = { ...ctx.context.options, baseURL: base };
}
