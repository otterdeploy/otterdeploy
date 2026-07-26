import { env } from "@otterdeploy/env/web";

/**
 * Everything the unauthenticated sign-in page needs from the server, fetched at
 * runtime rather than baked into the bundle.
 *
 * The provider list in particular has to come from here: a self-hoster runs a
 * prebuilt image, so the old build-time `VITE_AUTH_SOCIAL_PROVIDERS` meant SSO
 * could never be turned on without rebuilding the SPA. The server reports the
 * providers registered on the LIVE auth instance, so this can never render a
 * button for a provider that would dead-end.
 */

export type RegistrationMode = "bootstrap" | "invite-only" | "open";

export interface AuthPublicConfig {
  mode: RegistrationMode;
  socialProviders: string[];
}

const MODES = new Set<string>(["bootstrap", "invite-only", "open"]);

export async function fetchAuthPublicConfig(): Promise<AuthPublicConfig> {
  const response = await fetch(`${env.VITE_SERVER_URL}/api/auth/public-config`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to read registration status");
  const body = (await response.json()) as { mode?: unknown; socialProviders?: unknown };
  if (typeof body.mode !== "string" || !MODES.has(body.mode)) {
    throw new Error("Invalid registration status");
  }
  return {
    mode: body.mode as RegistrationMode,
    socialProviders: Array.isArray(body.socialProviders)
      ? body.socialProviders.filter((p): p is string => typeof p === "string")
      : [],
  };
}
