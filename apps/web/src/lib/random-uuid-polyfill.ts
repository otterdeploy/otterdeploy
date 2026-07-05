/**
 * `crypto.randomUUID` is exposed by browsers ONLY in a "secure context" — HTTPS
 * or `http://localhost`. A self-hosted dashboard reached over plain
 * `http://<ip-or-host>:<port>` is NOT a secure context, so `crypto.randomUUID`
 * is `undefined` and every call throws `crypto.randomUUID is not a function`,
 * breaking any feature that mints a client-side id (git providers, backups,
 * api-keys, terminal sessions, the data grid…).
 *
 * `crypto.getRandomValues` IS available in insecure contexts, so we shim
 * `randomUUID` from it (RFC 4122 v4). No-op where the native function already
 * exists (HTTPS / localhost). Import this FIRST in the app entry so the shim is
 * installed before any feature code runs.
 */
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  const randomUUID = (): ReturnType<Crypto["randomUUID"]> => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte, i) => {
      // Set the version (4) and variant (10xx) bits per RFC 4122 §4.4.
      const b = i === 6 ? (byte & 0x0f) | 0x40 : i === 8 ? (byte & 0x3f) | 0x80 : byte;
      return b.toString(16).padStart(2, "0");
    }).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as ReturnType<
      Crypto["randomUUID"]
    >;
  };
  crypto.randomUUID = randomUUID;
}
