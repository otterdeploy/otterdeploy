/**
 * Symmetric encryption for at-rest secrets — registry passwords, future
 * PATs, anything else we wouldn't want to read out of a DB dump.
 *
 * The encryption key is derived (HKDF-SHA256) from `BETTER_AUTH_SECRET`
 * so we don't have to provision a separate KMS key for bootstrap. This
 * is a deliberate trade-off: if the auth secret leaks, every encrypted
 * secret in this DB is recoverable from a dump. Acceptable for a
 * single-tenant self-hosted deploy; the same key-derivation contract
 * leaves a clean upgrade path to a real KMS later (just swap the key
 * material, re-encrypt with a `kid` prefix).
 *
 * Ciphertext layout (base64url-encoded as a single string):
 *
 *     v1.<nonce>.<ciphertext_with_tag>
 *
 *   - `v1`: format version. Lets us migrate without dropping data.
 *   - nonce: 12 random bytes (AES-GCM standard).
 *   - ciphertext_with_tag: AES-GCM output (plaintext || 16-byte tag).
 *
 * Each call uses a fresh random nonce — never reuse one with the same key.
 */

import { env } from "@otterdeploy/env/server";

const FORMAT_VERSION = "v1";
const NONCE_BYTES = 12;
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
      // Deterministic salt — the env secret is the entropy source, the
      // salt only domain-separates this key from other HKDF uses of the
      // same secret (cookie signing, etc.).
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

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  return [
    FORMAT_VERSION,
    base64UrlEncode(nonce),
    base64UrlEncode(new Uint8Array(ciphertext)),
  ].join(".");
}

export async function decryptSecret(blob: string): Promise<string> {
  const parts = blob.split(".");
  if (parts.length !== 3) {
    throw new Error("encryptSecret: malformed ciphertext (expected v.n.c)");
  }
  const [version, nonceB64, cipherB64] = parts as [string, string, string];
  if (version !== FORMAT_VERSION) {
    throw new Error(`encryptSecret: unsupported version ${version}`);
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

/**
 * Binary AES-GCM for backup archives — same derived key as `encryptSecret`,
 * but operates on raw bytes (no base64 round-trip) so large dumps don't bloat.
 * Framing: 12-byte nonce prefix, then AES-GCM ciphertext+tag.
 */
export async function encryptBytes(plaintext: Uint8Array): Promise<Buffer> {
  const key = await getKey();
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext as unknown as ArrayBuffer,
  );
  return Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
}

export async function decryptBytes(blob: Uint8Array): Promise<Buffer> {
  const nonce = blob.subarray(0, NONCE_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES);
  const key = await getKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as unknown as ArrayBuffer },
    key,
    ciphertext as unknown as ArrayBuffer,
  );
  return Buffer.from(plaintext);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const fill = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  const bin = atob(padded + "=".repeat(fill));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
