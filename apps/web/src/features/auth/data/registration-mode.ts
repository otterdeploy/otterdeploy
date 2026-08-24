import { env } from "@otterdeploy/env/web";
import * as z from "zod";

/**
 * Everything the unauthenticated sign-in page needs from the server, fetched at
 * runtime rather than baked into the bundle.
 *
 * The provider list in particular has to come from here: a self-hoster runs a
 * prebuilt image, so the old build-time `VITE_AUTH_SOCIAL_PROVIDERS` meant SSO
 * could never be turned on without rebuilding the SPA. The server reports what
 * is live on the auth instance right now, so this can never render a button
 * that would dead-end.
 *
 * `signIn` and `ssoProviders` shape the page; they do NOT secure it. The server
 * refuses a disabled method's requests in front of the better-auth handler (see
 * packages/auth/src/public-config.ts), so an SPA that skipped this fetch gets a
 * 403, not a way in.
 */

export type RegistrationMode = "bootstrap" | "invite-only" | "open";

/** One "Continue with <IdP>" button. `providerId` is the handle in the
 *  callback URL; `label` is what the button says. */
export interface PublicSsoProvider {
  providerId: string;
  label: string;
}

export interface AuthPublicConfig {
  mode: RegistrationMode;
  socialProviders: string[];
  signIn: { password: boolean; passkey: boolean; sso: boolean };
  ssoProviders: PublicSsoProvider[];
}

/**
 * Parsed, not cast, and every added field has a default.
 *
 * The defaults are what an SPA cached across an upgrade sees when it talks to
 * an older server that doesn't send these keys yet: all methods on and no SSO
 * buttons, which is exactly the behaviour that shipped before this endpoint
 * grew them. A stricter schema would break the sign-in page during the window
 * where a browser holds the new bundle and the server is still restarting.
 */
const publicConfigSchema = z.object({
  mode: z.enum(["bootstrap", "invite-only", "open"]),
  socialProviders: z.array(z.string()).default([]),
  signIn: z
    .object({
      password: z.boolean().default(true),
      passkey: z.boolean().default(true),
      sso: z.boolean().default(true),
    })
    .default({ password: true, passkey: true, sso: true }),
  ssoProviders: z.array(z.object({ providerId: z.string(), label: z.string() })).default([]),
});

export async function fetchAuthPublicConfig(): Promise<AuthPublicConfig> {
  const response = await fetch(`${env.VITE_SERVER_URL}/api/auth/public-config`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to read registration status");
  const parsed = publicConfigSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid registration status");
  return parsed.data;
}

/**
 * What the sign-in page renders with before the real config arrives.
 *
 * Every method on, matching what the page did before it knew about the setting
 * at all. A disabled method that flashes visible for one request is a cosmetic
 * problem; a page that renders no way in while the fetch is in flight looks
 * like a broken installation.
 */
export const PENDING_AUTH_CONFIG: AuthPublicConfig = {
  mode: "invite-only",
  socialProviders: [],
  signIn: { password: true, passkey: true, sso: true },
  ssoProviders: [],
};
