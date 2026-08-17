import type { VaultProviderConfig } from "@otterdeploy/db/schema";

export type VaultProviderKind = "hashicorp" | "infisical" | "doppler";

/**
 * A provider ready to talk to: the DB row's non-secret config plus the
 * DECRYPTED credential. Built at the callsite (resolver / router handlers)
 * via `decryptForDomain(row.credentialCiphertext, "vault-creds")` so the
 * client modules stay pure HTTP + parsing (unit-testable without crypto/env).
 */
export interface VaultProviderRuntime {
  name: string;
  kind: VaultProviderKind;
  config: VaultProviderConfig;
  credential: string;
}
