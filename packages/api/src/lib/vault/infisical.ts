/**
 * Infisical client. Universal Auth (machine identity) against cloud or a
 * self-hosted instance.
 *
 * Ref syntax: the secret key. One raw-secrets fetch per resolve call: refs
 * are looked up in that single snapshot, with secret references (`${OTHER}`)
 * expanded and imported folders included, as Infisical resolves them for its
 * own clients. Access tokens are reused until shortly before they expire
 * instead of logging in on every resolve.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import * as z from "zod";

import type { VaultProviderRuntime } from "./types";

import { normalizeBaseUrl, vaultFetch } from "./http";

const INFISICAL_CLOUD_URL = "https://app.infisical.com";

/** Log in again this long before Infisical says the token expires. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

const loginSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().positive().optional(),
});

const secretListSchema = z.array(
  z.object({
    secretKey: z.string(),
    secretValue: z.string(),
  }),
);

const secretsSchema = z.object({
  secrets: secretListSchema,
  /** Present with include_imports=true: the imported folders' secrets. */
  imports: z.array(z.object({ secrets: secretListSchema })).optional(),
});

/** Access tokens by instance + machine identity + secret. */
const accessTokens = new Map<string, { token: string; refreshAt: number }>();

function baseUrl(provider: VaultProviderRuntime): string {
  return normalizeBaseUrl(provider.config.siteUrl || INFISICAL_CLOUD_URL);
}

async function login(provider: VaultProviderRuntime): Promise<string> {
  const clientId = provider.config.clientId;
  if (!clientId) {
    throw new Error(`secret provider "${provider.name}": missing Infisical client ID`);
  }
  const cacheKey = `${baseUrl(provider)} ${clientId} ${provider.credential}`;
  const now = Temporal.Now.instant().epochMilliseconds;
  const cached = accessTokens.get(cacheKey);
  if (cached && cached.refreshAt > now) return cached.token;
  const body = await vaultFetch({
    providerName: provider.name,
    url: `${baseUrl(provider)}/api/v1/auth/universal-auth/login`,
    schema: loginSchema,
    method: "POST",
    body: { clientId, clientSecret: provider.credential },
  });
  if (body.expiresIn !== undefined) {
    accessTokens.set(cacheKey, {
      token: body.accessToken,
      refreshAt: now + body.expiresIn * 1000 - ACCESS_TOKEN_REFRESH_MARGIN_MS,
    });
  }
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
    // Both default to false on this endpoint: a `${OTHER}` reference reached
    // containers as that literal text, and imported secrets were "missing".
    expandSecretReferences: "true",
    include_imports: "true",
  });
  const body = await vaultFetch({
    providerName: provider.name,
    url: `${baseUrl(provider)}/api/v3/secrets/raw?${params.toString()}`,
    schema: secretsSchema,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  // The folder's own secrets win over imported ones, as in Infisical.
  const imported = (body.imports ?? []).flatMap((folder) => folder.secrets);
  return new Map([...imported, ...body.secrets].map((s) => [s.secretKey, s.secretValue]));
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
