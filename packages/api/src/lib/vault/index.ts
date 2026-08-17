/**
 * External secret-manager clients (HashiCorp Vault / OpenBao KV v2,
 * Infisical, Doppler) behind one kind-dispatched surface.
 *
 * `getSecrets` is batched by design: the env resolver groups every
 * `${{vault.<provider>.<ref>}}` token by provider and calls this ONCE per
 * provider per resolve, so each deploy costs at most one login + one fetch
 * per provider regardless of how many refs it uses. Nothing is cached beyond
 * that single call, and resolved values are never persisted.
 *
 * AWS Secrets Manager / Azure Key Vault / Scaleway are out of scope for now;
 * adding one is a new `VaultProviderKind` member + client module + a case in
 * each dispatch below.
 */

import type { VaultProviderRuntime } from "./types";

import { dopplerGetSecrets, dopplerListSecretNames, dopplerTest } from "./doppler";
import { hashicorpGetSecrets, hashicorpListSecretNames, hashicorpTest } from "./hashicorp";
import { infisicalGetSecrets, infisicalListSecretNames, infisicalTest } from "./infisical";

export type { VaultProviderKind, VaultProviderRuntime } from "./types";

/**
 * Fetch `refs` from the provider in one batch. Throws an `Error` with an
 * operator-actionable message (provider name + HTTP status/reason — never the
 * credential or a secret value) on any failure, including a ref the provider
 * doesn't hold.
 */
export async function getSecrets(
  provider: VaultProviderRuntime,
  refs: string[],
): Promise<Map<string, string>> {
  switch (provider.kind) {
    case "hashicorp":
      return hashicorpGetSecrets(provider, refs);
    case "infisical":
      return infisicalGetSecrets(provider, refs);
    case "doppler":
      return dopplerGetSecrets(provider, refs);
  }
}

/** Round-trip the stored credential. Throws with the reason on failure. */
export async function testProvider(provider: VaultProviderRuntime): Promise<void> {
  switch (provider.kind) {
    case "hashicorp":
      return hashicorpTest(provider);
    case "infisical":
      return infisicalTest(provider);
    case "doppler":
      return dopplerTest(provider);
  }
}

/**
 * Best-effort key listing for the reference picker. Throws on provider
 * failure — callers that want "empty on error" (the picker path) catch it.
 */
export async function listSecretNames(provider: VaultProviderRuntime): Promise<string[]> {
  switch (provider.kind) {
    case "hashicorp":
      return hashicorpListSecretNames(provider);
    case "infisical":
      return infisicalListSecretNames(provider);
    case "doppler":
      return dopplerListSecretNames(provider);
  }
}
