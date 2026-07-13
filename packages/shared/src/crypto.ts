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

/**
 * Cryptographically-strong random secret as a URL-safe base64 string (no
 * padding). Used to pre-fill secret-shaped template/compose variables (e.g.
 * `POSTGRES_PASSWORD`) so the operator never hand-types a password — the same
 * convenience the Postgres provisioner gives itself with
 * `randomBytes(18).toString("base64url")`. `bytes` sets the entropy (default 24
 * → 32 chars). Isomorphic: `getRandomValues` + `btoa` exist in both the browser
 * and Node.
 */
export function randomSecret(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * HMAC-SHA256 of a UTF-8 string (or raw bytes) as lowercase hex. The one
 * canonical implementation for webhook payload signing/verification — the
 * outbound delivery job (packages/jobs) signs with it and the API's inbound
 * verifier + tests use the same function, so both sides can never drift.
 */
export async function hmacSha256Hex(secret: string, body: string | ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
  const mac = await crypto.subtle.sign("HMAC", key, data as unknown as ArrayBuffer);
  return bytesToHex(new Uint8Array(mac));
}
