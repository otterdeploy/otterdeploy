import { env } from "@otterstack/env/server";

import { callGateway } from "./gateway-utils";
import type {
  BindingRef,
  ProviderEnsureBindingResult,
  ProviderRevealResult,
  ProviderUpsertResult,
  SecretProviderClient,
} from "./provider";
import type { SecretKind } from "./types";

type GatewayEnsureBindingResponse = {
  providerProjectId: string;
  providerProjectSlug: string;
};

type GatewayUpsertSecretResponse = {
  providerPath: string;
  providerKey: string;
  providerVersion: string | null;
};

type GatewayRevealSecretResponse = {
  value: string;
  providerVersion: string | null;
};

export class InfisicalGatewayProvider implements SecretProviderClient {
  readonly name = "infisical" as const;

  async ensureOrganizationBinding(organizationId: string): Promise<ProviderEnsureBindingResult> {
    const projectPrefix = env.INFISICAL_PROJECT_PREFIX ?? "otterstack";

    return callGateway<GatewayEnsureBindingResponse>("/v1/bindings/ensure", {
      organizationId,
      projectPrefix,
    });
  }

  async upsertSecret(input: {
    binding: BindingRef;
    kind: SecretKind;
    path: string;
    key: string;
    plaintext: string;
  }): Promise<ProviderUpsertResult> {
    return callGateway<GatewayUpsertSecretResponse>("/v1/secrets/upsert", {
      organizationId: input.binding.organizationId,
      providerProjectId: input.binding.providerProjectId,
      kind: input.kind,
      path: input.path,
      key: input.key,
      value: input.plaintext,
    });
  }

  async revealSecret(input: {
    binding: BindingRef;
    kind: SecretKind;
    path: string;
    key: string;
    version: string | null;
  }): Promise<ProviderRevealResult> {
    return callGateway<GatewayRevealSecretResponse>("/v1/secrets/reveal", {
      organizationId: input.binding.organizationId,
      providerProjectId: input.binding.providerProjectId,
      kind: input.kind,
      path: input.path,
      key: input.key,
      version: input.version,
    });
  }
}
