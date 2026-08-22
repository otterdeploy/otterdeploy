/**
 * Everything the UNAUTHENTICATED sign-in page is told, and the gate that makes
 * those answers binding.
 *
 * The two halves belong in one file on purpose. `publicAuthConfig` decides
 * which sign-in controls the page renders; `guardSignInMethod` decides which
 * sign-in requests the server accepts. If they ever disagree, the page shows a
 * button that 403s (annoying) or hides one that still works (a disabled method
 * that isn't). Reading the same policy through the same two functions is what
 * keeps them from drifting.
 *
 * Nothing here may widen what an anonymous caller learns. The response carries
 * the registration mode, which methods are on, the social provider ids already
 * visible as buttons, and the SSO handles that already appear in callback URLs.
 * No issuer, no email domain, no organization, no credential.
 */

import type { SignInMethods } from "./sign-in-methods";
import type { PublicSsoProvider } from "./sso-directory";

import { enabledSocialProviderIds } from "./live-providers";
import {
  getRegistrationMode,
  type RegistrationMode,
  resolveSignInMethods,
} from "./platform-config";
import { isAuthPathAllowed, methodForAuthPath } from "./sign-in-methods";
import { listPublicSsoProviders } from "./sso-directory";

/** Where the better-auth handler is mounted in apps/server. */
const AUTH_MOUNT = "/api/auth";

const DISABLED_MESSAGE: Record<keyof SignInMethods, string> = {
  password: "Password sign-in is disabled on this installation.",
  passkey: "Passkey sign-in is disabled on this installation.",
  sso: "Single sign-on is disabled on this installation.",
};

export interface PublicAuthConfig {
  mode: RegistrationMode;
  socialProviders: string[];
  /** Which of password / passkey / enterprise-SSO the page may offer. */
  signIn: SignInMethods;
  /** One button each. Empty when SSO is off or nothing is registered. */
  ssoProviders: PublicSsoProvider[];
}

/**
 * Before the first account exists the only way in is `/sign-up/email` with the
 * installer's bootstrap token, so the page must offer the password form
 * whatever the stored policy says. The request gate makes the same exception
 * (see `isAuthPathAllowed`), which is what keeps this from being a lie.
 */
function effectiveMethods(methods: SignInMethods, mode: RegistrationMode): SignInMethods {
  return mode === "bootstrap" ? { ...methods, password: true } : methods;
}

export async function publicAuthConfig(): Promise<PublicAuthConfig> {
  const [mode, stored] = await Promise.all([getRegistrationMode(), resolveSignInMethods()]);
  const signIn = effectiveMethods(stored, mode);
  return {
    mode,
    socialProviders: enabledSocialProviderIds(),
    signIn,
    // Skipped entirely when SSO is off: the callback paths are gated anyway,
    // so advertising a provider here would only produce a button that 403s.
    ssoProviders: signIn.sso ? await listPublicSsoProviders() : [],
  };
}

/**
 * Refuse a request for a sign-in method this installation has turned off.
 *
 * Returns null for every path that is not a gated sign-in surface, which is
 * the overwhelming majority (`/get-session`, `/sign-out`, `/organization/*`,
 * the device-grant polling loop), and those pay no database read at all: the
 * settings lookup happens only after `methodForAuthPath` has already matched.
 *
 * `path` is the full request path including the `/api/auth` mount prefix; the
 * policy module works in mount-relative paths, so the prefix is stripped here.
 * A path that does not carry the prefix is not an auth request and is left
 * alone.
 */
export async function guardSignInMethod(path: string): Promise<Response | null> {
  const relative = path.startsWith(AUTH_MOUNT) ? path.slice(AUTH_MOUNT.length) : null;
  if (relative === null) return null;

  const method = methodForAuthPath(relative);
  if (method === null) return null;

  const [methods, mode] = await Promise.all([resolveSignInMethods(), getRegistrationMode()]);
  if (
    isAuthPathAllowed({
      path: relative,
      methods,
      bootstrapComplete: mode !== "bootstrap",
    })
  ) {
    return null;
  }

  // 403 rather than 404: the method exists, this installation has switched it
  // off. `code` matches the shape better-auth's own errors use so the client's
  // error handling needs no special case.
  return Response.json(
    {
      code: "SIGN_IN_METHOD_DISABLED",
      message: DISABLED_MESSAGE[method],
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
