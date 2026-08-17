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

function isRegistrationMode(value: string): value is RegistrationMode {
  return value === "bootstrap" || value === "invite-only" || value === "open";
}

export async function fetchAuthPublicConfig(): Promise<AuthPublicConfig> {
  const response = await fetch(`${env.VITE_SERVER_URL}/api/auth/public-config`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to read registration status");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid registration status");
  }
  const mode = "mode" in body ? body.mode : undefined;
  if (typeof mode !== "string" || !isRegistrationMode(mode)) {
    throw new Error("Invalid registration status");
  }
  const socialProviders = "socialProviders" in body ? body.socialProviders : undefined;
  return {
    mode,
    socialProviders: Array.isArray(socialProviders)
      ? socialProviders.filter((p): p is string => typeof p === "string")
      : [],
  };
}
