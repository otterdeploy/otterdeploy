/**
 * HashiCorp Vault / OpenBao client — KV v2 engine only.
 *
 * Ref syntax: `<path>:<field>`, split on the LAST colon so paths may contain
 * colons themselves. One `GET {url}/v1/{mount}/data/{path}` per distinct
 * path, shared across every field read from it.
 */

import * as z from "zod";

import type { VaultProviderRuntime } from "./types";

import { normalizeBaseUrl, vaultFetch } from "./http";

const kvReadSchema = z.object({
  data: z.object({
    data: z.record(z.string(), z.unknown()),
  }),
});

const kvListSchema = z.object({
  data: z.object({
    keys: z.array(z.string()),
  }),
});

// lookup-self returns a rich token descriptor; only reachability + auth
// matter for `test`, so accept any JSON body.
const lookupSelfSchema = z.unknown();

interface HashicorpTarget {
  base: string;
  mount: string;
  headers: Record<string, string>;
}

function target(provider: VaultProviderRuntime): HashicorpTarget {
  const url = provider.config.url;
  if (!url) {
    throw new Error(`secret provider "${provider.name}": missing Vault URL in configuration`);
  }
  return {
    base: normalizeBaseUrl(url),
    mount: provider.config.mount || "secret",
    headers: {
      "X-Vault-Token": provider.credential,
      ...(provider.config.namespace ? { "X-Vault-Namespace": provider.config.namespace } : {}),
    },
  };
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Split `<path>:<field>` on the LAST colon. Both halves must be non-empty. */
export function splitHashicorpRef(
  providerName: string,
  ref: string,
): { path: string; field: string } {
  const idx = ref.lastIndexOf(":");
  const path = idx === -1 ? "" : ref.slice(0, idx);
  const field = idx === -1 ? "" : ref.slice(idx + 1);
  if (!path || !field) {
    throw new Error(
      `secret provider "${providerName}": ref "${ref}" must be "<path>:<field>" for HashiCorp Vault`,
    );
  }
  return { path, field };
}

export async function hashicorpGetSecrets(
  provider: VaultProviderRuntime,
  refs: string[],
): Promise<Map<string, string>> {
  const t = target(provider);

  // Group by path so N fields on one secret cost one read.
  const byPath = new Map<string, Array<{ ref: string; field: string }>>();
  for (const ref of refs) {
    const { path, field } = splitHashicorpRef(provider.name, ref);
    const bucket = byPath.get(path);
    if (bucket) bucket.push({ ref, field });
    else byPath.set(path, [{ ref, field }]);
  }

  const out = new Map<string, string>();
  for (const [path, fields] of byPath) {
    const body = await vaultFetch({
      providerName: provider.name,
      url: `${t.base}/v1/${encodePath(t.mount)}/data/${encodePath(path)}`,
      schema: kvReadSchema,
      headers: t.headers,
    });
    for (const { ref, field } of fields) {
      const value = body.data.data[field];
      if (value === undefined) {
        throw new Error(
          `secret provider "${provider.name}": secret "${path}" has no field "${field}"`,
        );
      }
      out.set(ref, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  return out;
}

/** Auth + reachability round-trip against the stored token. */
export async function hashicorpTest(provider: VaultProviderRuntime): Promise<void> {
  const t = target(provider);
  await vaultFetch({
    providerName: provider.name,
    url: `${t.base}/v1/auth/token/lookup-self`,
    schema: lookupSelfSchema,
    headers: t.headers,
  });
}

const LIST_MAX_DEPTH = 4;
const LIST_MAX_ENTRIES = 200;

/**
 * Best-effort recursive KV v2 metadata listing for the reference picker.
 * Returns secret paths (the `<path>` half of a ref — the operator appends
 * `:<field>`). Depth/entry caps keep a huge mount from stalling the picker.
 * Callers treat any throw as "no listing available".
 */
export async function hashicorpListSecretNames(provider: VaultProviderRuntime): Promise<string[]> {
  const t = target(provider);
  const names: string[] = [];

  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > LIST_MAX_DEPTH || names.length >= LIST_MAX_ENTRIES) return;
    const body = await vaultFetch({
      providerName: provider.name,
      url: `${t.base}/v1/${encodePath(t.mount)}/metadata/${encodePath(prefix)}?list=true`,
      schema: kvListSchema,
      headers: t.headers,
    });
    for (const key of body.data.keys) {
      if (names.length >= LIST_MAX_ENTRIES) return;
      const full = `${prefix}${key}`;
      if (key.endsWith("/")) {
        await walk(full, depth + 1);
      } else {
        names.push(full);
      }
    }
  };

  await walk("", 1);
  return names;
}
