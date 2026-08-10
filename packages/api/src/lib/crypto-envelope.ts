/**
 * The on-the-wire ciphertext envelope: the two layouts we write, how to build
 * one, and how to read one back. The base64url codec both are spelled in is
 * `@otterdeploy/shared/crypto`, shared with the token signers, which have to
 * agree with it byte-for-byte.
 *
 *     v1.<nonce>.<ciphertext_with_tag>
 *     v2:<domain>:<keyId>:<nonce>:<ciphertext_with_tag>
 *
 * Split out of ./crypto.ts so that module is purely about *keys and AES*.
 * Keyring, HKDF domain separation, encrypt/decrypt/rotate. This one owns the
 * string format, which is the part that must stay byte-for-byte stable forever
 * (every secret already sitting in the database is written in it) and is
 * therefore worth keeping in one small, obvious place. Nothing here touches
 * key material, so it is safe to read in isolation when reasoning about a
 * stored blob.
 */
import { base64UrlDecode, base64UrlEncode } from "@otterdeploy/shared/crypto";

const V1_FORMAT = "v1";
const V2_FORMAT = "v2";

export function isV1Format(blob: string): boolean {
  return blob.startsWith(`${V1_FORMAT}.`);
}

export function isV2Format(blob: string): boolean {
  return blob.startsWith(`${V2_FORMAT}:`);
}

export function formatV1Envelope(nonce: Uint8Array, ciphertext: Uint8Array): string {
  return [V1_FORMAT, base64UrlEncode(nonce), base64UrlEncode(ciphertext)].join(".");
}

export function formatV2Envelope(
  domain: string,
  keyId: string,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): string {
  return [V2_FORMAT, domain, keyId, base64UrlEncode(nonce), base64UrlEncode(ciphertext)].join(":");
}

export interface ParsedV1Envelope {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** Errors keep the `encryptSecret:` prefix they were first written with.
 *  They're the messages operators have seen in logs since v1 shipped. */
export function parseV1Envelope(blob: string): ParsedV1Envelope {
  const parts = blob.split(".");
  if (parts.length !== 3) {
    throw new Error("encryptSecret: malformed ciphertext (expected v.n.c)");
  }
  const [version, nonceB64, cipherB64] = parts as [string, string, string];
  if (version !== V1_FORMAT) {
    throw new Error(`encryptSecret: unsupported version ${version}`);
  }
  return { nonce: base64UrlDecode(nonceB64), ciphertext: base64UrlDecode(cipherB64) };
}

export interface ParsedV2Envelope {
  domain: string;
  keyId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export function parseV2Envelope(blob: string): ParsedV2Envelope {
  const parts = blob.split(":");
  if (parts.length !== 5 || parts[0] !== V2_FORMAT) {
    throw new Error("decryptForDomain: malformed ciphertext (expected v2:domain:keyId:nonce:ct)");
  }
  const [, domain, keyId, nonceB64, cipherB64] = parts as [string, string, string, string, string];
  return {
    domain,
    keyId,
    nonce: base64UrlDecode(nonceB64),
    ciphertext: base64UrlDecode(cipherB64),
  };
}
