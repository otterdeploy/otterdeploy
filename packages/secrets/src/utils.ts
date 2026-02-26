import { createId } from "@otterdeploy/utils";
import { InfisicalGatewayProvider } from "./infisical-gateway";
import { NativeBreakglassProvider } from "./native-breakglass";
import type { SecretProviderClient } from "./provider";
import type { SecretLogicalScope, SecretProvider } from "./types";

export function createSecretId() {
  return createId();
}

export function buildProviderPath(
  providerProjectSlug: string,
  logicalScope: SecretLogicalScope,
  logicalScopeId: string,
) {
  const scopeId = logicalScopeId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `/otterstack/projects/${providerProjectSlug}/${logicalScope}/${scopeId}`;
}

export function getProviderClient(provider: SecretProvider): SecretProviderClient {
  if (provider === "infisical") {
    return new InfisicalGatewayProvider();
  }

  return new NativeBreakglassProvider();
}
