/**
 * Which ways of proving who you are this installation accepts, and the pure
 * policy that decides whether a given better-auth request path is one of them.
 *
 * Split out of ./platform-config.ts on purpose: this half has no database and
 * no env import, so the hostile-path tests for it run without a configured
 * environment. The half that reads `platform_settings` lives next door, and
 * the enforcement point that consumes both lives in apps/server/src/index.ts.
 *
 * Three rules hold this file together, and they are the same three that make
 * the audit allowlist next door safe:
 *
 *  1. **Deny by path prefix, never by guessing.** Every gated path is listed
 *     explicitly. A better-auth upgrade that adds a new sign-in route does not
 *     silently fall through to "allowed" for a disabled method, because the
 *     prefixes are the plugin mount points, not individual endpoints.
 *  2. **A disabled method is disabled at the SERVER.** Hiding a button is
 *     presentation. The sign-in page reflects this policy so it never renders
 *     a control that dead-ends, but the page is not what enforces it.
 *  3. **Never lock the operator out.** {@link wouldLockOut} is the floor: at
 *     least one method that every existing account can actually use has to
 *     survive any save.
 */

/** The sign-in surfaces an operator can turn off, one at a time. */
export const SIGN_IN_METHOD_IDS = ["password", "passkey", "sso"] as const;
export type SignInMethodId = (typeof SIGN_IN_METHOD_IDS)[number];

export type SignInMethods = Record<SignInMethodId, boolean>;

/**
 * What an installation gets before an operator touches anything, and what a
 * failed settings read falls back to.
 *
 * Note this fails OPEN, the opposite of `registrationPolicy()` next door, and
 * the asymmetry is deliberate. Registration decides whether a STRANGER may
 * create an account, so a database blip must not admit one. This decides
 * whether an EXISTING account may sign in, so a database blip must not lock
 * the operator out of the box they are trying to fix.
 */
export const DEFAULT_SIGN_IN_METHODS: SignInMethods = {
  password: true,
  passkey: true,
  sso: true,
};

/**
 * better-auth route prefixes owned by each method.
 *
 * `password` covers sign-up and the reset flow as well as sign-in: an
 * installation that has turned passwords off should not be minting new ones
 * through `/reset-password` either. `/change-password` is deliberately absent.
 * It requires a live session, and a signed-in user rotating a credential they
 * can no longer use to sign in is harmless.
 *
 * `sso` covers only the sign-in and callback paths, NOT `/sso/register`,
 * `/sso/providers` or `/sso/delete`. Those are the workspace settings page,
 * already admin-authorized by the plugin, and an operator has to be able to
 * configure an identity provider BEFORE switching the method on. Gating them
 * would make enabling SSO a chicken-and-egg problem.
 */
const GATED_PREFIXES: Record<SignInMethodId, readonly string[]> = {
  password: ["/sign-in/email", "/sign-up/email", "/request-password-reset", "/reset-password"],
  passkey: ["/passkey/"],
  sso: ["/sign-in/sso", "/sso/callback", "/sso/saml2/"],
};

/**
 * The method that owns this better-auth route path, or null when the path is
 * not a sign-in surface at all (`/get-session`, `/sign-out`, `/organization/*`
 * and everything else stays reachable no matter what is switched off).
 *
 * `path` is the path RELATIVE to the better-auth mount point, matching the
 * keys in ./audit-policy.ts: `/sign-in/email`, not `/api/auth/sign-in/email`.
 */
export function methodForAuthPath(path: string): SignInMethodId | null {
  for (const id of SIGN_IN_METHOD_IDS) {
    for (const prefix of GATED_PREFIXES[id]) {
      if (path === prefix || path.startsWith(prefix)) return id;
    }
  }
  return null;
}

/**
 * Is this request allowed through, given the installation's policy?
 *
 * `bootstrapComplete` is the escape hatch that keeps a fresh install
 * installable. Before the first account exists the only way in is
 * `/sign-up/email` with the installer's bootstrap token, so the password
 * method is forced on until that has happened, whatever the column says. An
 * operator who disabled passwords and then restored the database from a
 * pre-bootstrap dump would otherwise own a box nobody can enter.
 */
export function isAuthPathAllowed(input: {
  path: string;
  methods: SignInMethods;
  bootstrapComplete: boolean;
}): boolean {
  const method = methodForAuthPath(input.path);
  if (method === null) return true;
  if (method === "password" && !input.bootstrapComplete) return true;
  return input.methods[method];
}

/**
 * Would saving this set leave someone holding an account with no way back in?
 *
 * The floor is stricter than "at least one box is ticked", because the methods
 * are not interchangeable from a user's point of view:
 *
 *  - A **passkey** is per-user. Leaving only passkeys on locks out every
 *    account that has not registered one, which on a normal install is most of
 *    them, and they cannot register one without first signing in.
 *  - **SSO** only admits addresses at a domain with a registered provider, so
 *    it is a real alternative only once a provider actually exists.
 *  - A **social provider** only admits accounts linked to it, but it is at
 *    least available to everyone with an account at that vendor, and it is the
 *    conventional way to run a password-less install.
 *
 * So: passwords may be switched off only when a federated method is live in
 * its place. Passkeys and SSO may always be switched off, because password
 * sign-in remains for everyone.
 */
export function wouldLockOut(input: {
  methods: SignInMethods;
  /** Social providers registered on the LIVE auth instance, not merely saved. */
  liveSocialProviderCount: number;
  /** Rows in `sso_provider`. Zero means the SSO switch admits nobody. */
  registeredSsoProviderCount: number;
}): boolean {
  if (input.methods.password) return false;
  if (input.liveSocialProviderCount > 0) return false;
  return !(input.methods.sso && input.registeredSsoProviderCount > 0);
}
