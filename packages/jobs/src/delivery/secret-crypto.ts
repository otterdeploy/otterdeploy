/**
 * Symmetric encryption for notification-channel secrets (bot tokens, HMAC
 * signing keys). Lives in @otterdeploy/jobs because both sides of the channel
 * lifecycle touch it and `jobs` is the lowest package both can import:
 *
 *   - the API router encrypts on create/update (imports this module)
 *   - the channel-delivery job decrypts on send (right here)
 *
 * Same construction as packages/api/src/lib/crypto.ts — HKDF-SHA256 off
 * BETTER_AUTH_SECRET, AES-256-GCM, `v1.<nonce>.<ciphertext>` base64url framing,
 * fresh random nonce per call. Because the key is derived deterministically
 * from the env secret, ciphertext written by the API decrypts here without any
 * shared key material beyond the env.
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
