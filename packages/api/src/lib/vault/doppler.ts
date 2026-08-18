/**
 * Doppler client: service-token access to one config's secrets.
 *
 * Ref syntax: the secret key. A service token is usually pre-scoped to a
 * single project+config; `dopplerProject`/`dopplerConfig` are only needed
 * for tokens that aren't.
 */

import * as z from "zod";

import type { VaultProviderRuntime } from "./types";

import { vaultFetch } from "./http";

const DOPPLER_API_URL = "https://api.doppler.com";

// `format=json` download: a flat { KEY: value } object. Values are strings in
// practice, but the API doesn't promise it: non-strings are stringified.
const downloadSchema = z.record(z.string(), z.unknown());

async function fetchAll(provider: VaultProviderRuntime): Promise<Map<string, string>> {
  const params = new URLSearchParams({ format: "json" });
  if (provider.config.dopplerProject) params.set("project", provider.config.dopplerProject);
  if (provider.config.dopplerConfig) params.set("config", provider.config.dopplerConfig);

  const body = await vaultFetch({
    providerName: provider.name,
    url: `${DOPPLER_API_URL}/v3/configs/config/secrets/download?${params.toString()}`,
    schema: downloadSchema,
    headers: { authorization: `Bearer ${provider.credential}` },
  });
  return new Map(
    Object.entries(body).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
}

export async function dopplerGetSecrets(
  provider: VaultProviderRuntime,
  refs: string[],
): Promise<Map<string, string>> {
  const all = await fetchAll(provider);
  const out = new Map<string, string>();
  for (const ref of refs) {
    const value = all.get(ref);
    if (value === undefined) {
      throw new Error(
        `secret provider "${provider.name}": no secret named "${ref}" in the configured Doppler config`,
      );
    }
    out.set(ref, value);
  }
  return out;
}

export async function dopplerTest(provider: VaultProviderRuntime): Promise<void> {
  await fetchAll(provider);
}

export async function dopplerListSecretNames(provider: VaultProviderRuntime): Promise<string[]> {
  return [...(await fetchAll(provider)).keys()];
}
