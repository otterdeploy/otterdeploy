/**
 * SSO provider reads/writes for the workspace settings page.
 *
 * READS go through our own org-scoped `sso.listProviders` (see
 * packages/api/src/routers/sso/index.ts). That router delegates to the plugin
 * for authorization and redaction (it never re-implements either) and adds
 * only the workspace scope, so a settings page cannot receive a different
 * workspace's identity-provider metadata.
 *
 * WRITES still go straight to `authClient.sso.*`. They are single-object
 * operations the plugin already authorizes per provider (`checkProviderAccess`
 * → `isOrgAdmin`), so wrapping them would add a second authorization path to
 * keep correct for no gain.
 *
 * Either way the client secret never leaves the server: `sso_provider
 * .oidc_config` is not read into any response shape (see
 * packages/db/src/schema/auth.ts).
 */

import type { SsoProviderView } from "@otterdeploy/api/routers/sso/contract";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/shared/server/orpc";

/** One provider as the redacted, org-scoped list endpoint returns it. */
export type SsoProvider = SsoProviderView;

const ssoProvidersKey = (organizationId: string) => ["sso", "providers", organizationId] as const;

/**
 * The workspace's registered identity providers.
 *
 * Reads through our own org-scoped `sso.listProviders` rather than better-auth's
 * `/sso/providers` directly. The plugin endpoint is correctly authorized. It
 * only returns providers for organizations where you are an admin, but it
 * returns them for ALL such organizations, and this page needs exactly one.
 *
 * Narrowing that in the browser was the wrong shape: a `.filter()` here is
 * presentation, never a boundary, and it read as though it were doing security
 * work. The server now scopes to the active organization (see
 * packages/api/src/routers/sso/index.ts), so another workspace's
 * identity-provider metadata never crosses the wire at all.
 */
export function useSsoProviders(organizationId: string) {
  return useQuery({
    ...orpc.sso.listProviders.queryOptions({ input: {} }),
    queryKey: ssoProvidersKey(organizationId),
    // The page renders this failure inline via ErrorState, so opt out of the
    // global error toast in shared/server/orpc.ts: otherwise the same error is
    // reported twice, once in the body and once in a toast with its own
    // competing retry button.
    meta: { suppressErrorToast: true },
    select: (data) => data.providers,
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
