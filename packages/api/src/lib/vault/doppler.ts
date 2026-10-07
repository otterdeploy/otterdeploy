/**
 * Doppler client: service-token access to one config's secrets.
 *
 * Ref syntax: the secret key. A service token (`dp.st.`) is scoped to exactly
 * one project+config; every other kind (personal `dp.pt.`, CLI `dp.ct.`,
 * service account `dp.sa.`) must name both, which Doppler requires and the
 * client now checks before calling.
 */

import * as z from "zod";

import type { VaultProviderRuntime } from "./types";

import { vaultFetch } from "./http";

const DOPPLER_API_URL = "https://api.doppler.com";

// `format=json` download: a flat { KEY: value } object. Values are strings in
// practice, but the API doesn't promise it: non-strings are stringified.
const downloadSchema = z.record(z.string(), z.unknown());

/** Doppler adds these to every download; they describe the config, they are
 *  not secrets anyone stored, so the picker does not offer them. */
const RESERVED_NAMES = new Set(["DOPPLER_PROJECT", "DOPPLER_ENVIRONMENT", "DOPPLER_CONFIG"]);

const SERVICE_TOKEN_PREFIX = "dp.st.";

function assertScoped(provider: VaultProviderRuntime): void {
  if (provider.credential.startsWith(SERVICE_TOKEN_PREFIX)) return;
  if (provider.config.dopplerProject && provider.config.dopplerConfig) return;
  throw new Error(
    `secret provider "${provider.name}": this Doppler token is not a service token (dp.st.), so ` +
      "Doppler needs the project and config it should read: set both, or use a service token",
  );
}

async function fetchAll(provider: VaultProviderRuntime): Promise<Map<string, string>> {
  assertScoped(provider);
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
  return [...(await fetchAll(provider)).keys()].filter((name) => !RESERVED_NAMES.has(name));
}
