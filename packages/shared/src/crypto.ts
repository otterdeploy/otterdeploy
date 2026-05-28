/**
 * Constant-time string comparison. Used wherever we compare a
 * client-supplied secret (HMAC signature, signed-state nonce) against a
 * server-computed value — branching on character mismatch leaks length
 * via timing.
 *
 * Lengths-differ short-circuit is intentional: equal-length strings
 * are the only meaningful comparison case for HMAC + base64 outputs,
 * and an attacker who can flex the length doesn't need the timing
 * channel anyway.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Lowercase hex encoding of a byte array. Matches Node's
 * `Buffer.from(bytes).toString("hex")` output so cross-platform code
 * doesn't have to reach for Buffer to compare digests.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
