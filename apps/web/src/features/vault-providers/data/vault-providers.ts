/**
 * Secret-provider reads/writes for the workspace settings page and the
 * new-resource wizard hint.
 *
 * Everything goes through the org-scoped `vaultProvider` oRPC router. The
 * credential is write-only end to end: the list view only ever carries
 * `credentialSet: boolean`, and an update without a credential keeps the
 * stored one.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

export function useVaultProviders() {
  return useQuery(orpc.vaultProvider.list.queryOptions({ input: {} }));
}

/** One provider as the masked list endpoint returns it. */
export type VaultProvider = NonNullable<ReturnType<typeof useVaultProviders>["data"]>[number];
export type VaultProviderKind = VaultProvider["kind"];

export const KIND_LABELS: Record<VaultProviderKind, string> = {
  hashicorp: "HashiCorp Vault / OpenBao",
  infisical: "Infisical",
  doppler: "Doppler",
};

/** Per-kind `<ref>` format for the `${{vault.<provider>.<ref>}}` help text. */
export const KIND_REF_HINTS: Record<VaultProviderKind, string> = {
  hashicorp: "<path>:<field>: e.g. app/db:PASSWORD (KV v2)",
  infisical: "<secret key>: e.g. DATABASE_URL",
  doppler: "<secret key>: e.g. API_KEY",
};

function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: orpc.vaultProvider.list.key() });
  };
}

export function useCreateVaultProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    ...orpc.vaultProvider.create.mutationOptions(),
    onSuccess: invalidate,
  });
}

export function useUpdateVaultProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    ...orpc.vaultProvider.update.mutationOptions(),
    onSuccess: invalidate,
  });
}

export function useRemoveVaultProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    ...orpc.vaultProvider.remove.mutationOptions(),
    onSuccess: invalidate,
  });
}

/** Round-trips the stored credential; the row's status/lastError update
 *  server-side, so the list refetches on settle either way. */
export function useTestVaultProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    ...orpc.vaultProvider.test.mutationOptions(),
    onSettled: invalidate,
  });
}
