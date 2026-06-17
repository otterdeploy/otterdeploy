/**
 * Decrypt at-rest secrets (Resend key / SMTP password) configured in platform
 * settings. This is the read side of `packages/api/src/lib/crypto.ts` — the
 * key derivation MUST match byte-for-byte so blobs encrypted by the API
 * decrypt here. Duplicated (like `packages/jobs/.../secret-crypto.ts`) because
 * the email package is a leaf shared by auth/jobs/api and can't import the API
 * layer; consolidating all three into a shared `@otterdeploy/crypto` package is
 * a sensible post-beta cleanup.
 */

import { env } from "@otterdeploy/env/server";

const FORMAT_VERSION = "v1";
const HKDF_INFO = "otterdeploy/secret-encryption/v1";

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const ikm = new TextEncoder().encode(env.BETTER_AUTH_SECRET);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    ikm as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"],
  );
  cachedKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("otterdeploy-secret-salt"),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

export async function decryptSecret(blob: string): Promise<string> {
  const parts = blob.split(".");
  if (parts.length !== 3) {
    throw new Error("decryptSecret: malformed ciphertext (expected v.n.c)");
  }
  const [version, nonceB64, cipherB64] = parts as [string, string, string];
  if (version !== FORMAT_VERSION) {
    throw new Error(`decryptSecret: unsupported version ${version}`);
  }
  const nonce = base64UrlDecode(nonceB64);
  const ciphertext = base64UrlDecode(cipherB64);
  const key = await getKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(plaintext);
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const fill = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  const bin = atob(padded + "=".repeat(fill));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
