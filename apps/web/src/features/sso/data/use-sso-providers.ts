/**
 * SSO provider reads/writes for the workspace settings page.
 *
 * These go through `authClient.sso.*` rather than an oRPC router on purpose.
 * The better-auth SSO plugin already does the two things a hand-rolled router
 * would exist to do: it scopes `/sso/providers` to organizations where the
 * caller is an admin, and it projects a REDACTED view of the OIDC config
 * (`clientIdLastFour`, endpoints, scopes — never the client secret, which is
 * the reason `sso_provider.oidc_config` must not be read directly; see
 * packages/db/src/schema/auth.ts). Wrapping it would duplicate that redaction
 * and give it a second place to drift out of sync.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";

type ProvidersResponse = NonNullable<Awaited<ReturnType<typeof authClient.sso.providers>>["data"]>;

/** One provider as the redacted list endpoint returns it. */
export type SsoProvider = ProvidersResponse["providers"][number];

const ssoProvidersKey = (organizationId: string) => ["sso", "providers", organizationId] as const;

/**
 * The workspace's registered identity providers.
 *
 * The endpoint returns every org the caller administers, so the result is
 * filtered down to this workspace — a user who administers two workspaces must
 * not see the other one's IdPs on this page.
 */
export function useSsoProviders(organizationId: string) {
  return useQuery({
    queryKey: ssoProvidersKey(organizationId),
    // The page renders this failure inline via ErrorState, so opt out of the
    // global error toast in shared/server/orpc.ts — otherwise the same "Not
    // Found" is reported twice, once in the body and once in a toast with its
    // own competing retry button.
    meta: { suppressErrorToast: true },
    queryFn: async () => {
      const result = await authClient.sso.providers();
      if (result.error) {
        throw new Error(
          result.error.message ?? result.error.statusText ?? "Could not load SSO providers",
        );
      }
      const providers = result.data?.providers ?? [];
      return providers.filter((provider) => provider.organizationId === organizationId);
    },
  });
}

export interface RegisterSsoInput {
  providerId: string;
  issuer: string;
  domain: string;
  clientId: string;
  clientSecret: string;
  discoveryEndpoint?: string;
}

export function useRegisterSsoProvider(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterSsoInput) => {
      const result = await authClient.sso.register({
        providerId: input.providerId,
        issuer: input.issuer,
        domain: input.domain,
        organizationId,
        oidcConfig: {
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          // Omitted rather than sent empty: the plugin derives the standard
          // `/.well-known/openid-configuration` path from the issuer when this
          // is absent, and an empty string would fail URL validation instead.
          ...(input.discoveryEndpoint ? { discoveryEndpoint: input.discoveryEndpoint } : {}),
        },
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? result.error.statusText ?? "Could not register provider",
        );
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ssoProvidersKey(organizationId) });
    },
  });
}

export function useDeleteSsoProvider(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const result = await authClient.sso.deleteProvider({ providerId });
      if (result.error) {
        throw new Error(
          result.error.message ?? result.error.statusText ?? "Could not remove provider",
        );
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ssoProvidersKey(organizationId) });
    },
  });
}
