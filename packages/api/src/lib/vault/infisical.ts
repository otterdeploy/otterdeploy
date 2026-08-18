/**
 * Infisical client. Universal Auth (machine identity) against cloud or a
 * self-hosted instance.
 *
 * Ref syntax: the secret key. One login + one raw-secrets fetch per resolve
 * call: refs are looked up in that single snapshot.
 */

import * as z from "zod";

import type { VaultProviderRuntime } from "./types";

import { normalizeBaseUrl, vaultFetch } from "./http";

const INFISICAL_CLOUD_URL = "https://app.infisical.com";

const loginSchema = z.object({
  accessToken: z.string(),
});

const secretsSchema = z.object({
  secrets: z.array(
    z.object({
      secretKey: z.string(),
      secretValue: z.string(),
    }),
  ),
});

function baseUrl(provider: VaultProviderRuntime): string {
  return normalizeBaseUrl(provider.config.siteUrl || INFISICAL_CLOUD_URL);
}

async function login(provider: VaultProviderRuntime): Promise<string> {
  const clientId = provider.config.clientId;
  if (!clientId) {
    throw new Error(`secret provider "${provider.name}": missing Infisical client ID`);
  }
  const body = await vaultFetch({
    providerName: provider.name,
    url: `${baseUrl(provider)}/api/v1/auth/universal-auth/login`,
    schema: loginSchema,
    method: "POST",
    body: { clientId, clientSecret: provider.credential },
  });
  return body.accessToken;
}

/** One snapshot of every secret in the configured project/env/path. */
async function fetchAll(provider: VaultProviderRuntime): Promise<Map<string, string>> {
  const { projectId, environmentSlug } = provider.config;
  if (!projectId || !environmentSlug) {
    throw new Error(
      `secret provider "${provider.name}": missing Infisical project ID or environment slug`,
    );
  }
  const accessToken = await login(provider);
  const params = new URLSearchParams({
    workspaceId: projectId,
    environment: environmentSlug,
    secretPath: provider.config.secretPath || "/",
  });
  const body = await vaultFetch({
    providerName: provider.name,
    url: `${baseUrl(provider)}/api/v3/secrets/raw?${params.toString()}`,
    schema: secretsSchema,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return new Map(body.secrets.map((s) => [s.secretKey, s.secretValue]));
}

export async function infisicalGetSecrets(
  provider: VaultProviderRuntime,
  refs: string[],
): Promise<Map<string, string>> {
  const all = await fetchAll(provider);
  const out = new Map<string, string>();
  for (const ref of refs) {
    const value = all.get(ref);
    if (value === undefined) {
      throw new Error(
        `secret provider "${provider.name}": no secret named "${ref}" in the configured Infisical environment`,
      );
    }
    out.set(ref, value);
  }
  return out;
}

/** Login AND read: a token that authenticates but can't reach the project
 *  should fail the test, not the first deploy. */
export async function infisicalTest(provider: VaultProviderRuntime): Promise<void> {
  await fetchAll(provider);
}

export async function infisicalListSecretNames(provider: VaultProviderRuntime): Promise<string[]> {
  return [...(await fetchAll(provider)).keys()];
}
