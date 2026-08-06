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
 * SHA-256 of a UTF-8 string as lowercase hex.
 *
 * Keep this isomorphic: API cache identities are generated in the server
 * today, but the same canonical scope may also be identified by browser and
 * worker transports without pulling in Node's `crypto` module.
 */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * URL-safe base64 (RFC 4648 §5), unpadded. The wire encoding for every
 * secret-bearing token this codebase mints — signed auth tokens, git OAuth
 * state, the health-agent token, and both AES-GCM envelope formats — so the
 * alphabet and padding rules have to be identical on the signing and verifying
 * side of each one. Kept here rather than reaching for `Buffer` so the browser
 * bundle can use it too.
 *
 * Not `toString("base64url")`: these run in Workers and the browser as well as
 * Node, where `Buffer` isn't guaranteed to exist.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Inverse of {@link base64UrlEncode}. Re-pads before decoding. */
export function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const fill = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  const bin = atob(padded + "=".repeat(fill));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
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
  return base64UrlEncode(buf);
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
