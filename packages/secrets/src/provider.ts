import type { SecretKind } from "./types";

export type BindingRef = {
  organizationId: string;
  providerProjectId: string;
  providerProjectSlug: string;
};

export type ProviderEnsureBindingResult = {
  providerProjectId: string;
  providerProjectSlug: string;
};

export type ProviderUpsertResult = {
  providerPath: string;
  providerKey: string;
  providerVersion: string | null;
};

export type ProviderRevealResult = {
  value: string;
  providerVersion: string | null;
};

export interface SecretProviderClient {
  readonly name: "infisical" | "native_breakglass";
  ensureOrganizationBinding(organizationId: string): Promise<ProviderEnsureBindingResult>;
  upsertSecret(input: {
    binding: BindingRef;
    kind: SecretKind;
    path: string;
    key: string;
    plaintext: string;
  }): Promise<ProviderUpsertResult>;
  revealSecret(input: {
    binding: BindingRef;
    kind: SecretKind;
    path: string;
    key: string;
    version: string | null;
  }): Promise<ProviderRevealResult>;
}
