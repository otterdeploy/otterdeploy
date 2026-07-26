/**
 * Control-plane backup recovery key — od-5j8.13.
 *
 * Every secret the platform stores at rest (SSH keys, registry creds, sealed
 * env vars, ...) is encrypted with a key derived from `DATA_ENCRYPTION_KEYS` /
 * `BETTER_AUTH_SECRET` (see `./crypto.ts`). That key material lives ONLY on
 * the control-plane host's `.env` file. A whole-control-plane backup that is
 * itself encrypted with that same key is worthless for disaster recovery: if
 * the host is gone, the key needed to read the backup is gone with it.
 *
 * The recovery key is the fix — a SEPARATE, high-entropy secret that:
 *
 *   1. Is generated independently of the keyring (`generateRecoveryKey`),
 *      never derived from or stored alongside `BETTER_AUTH_SECRET`.
 *   2. Is shown to the operator EXACTLY ONCE at generation time and must be
 *      stored off-host (password manager, printed + safe, etc.) — the
 *      platform never persists it, only a fingerprint (`recoveryKeyFingerprint`)
 *      so the readiness surface can confirm "yes, a key was generated" and
 *      let the operator verify they're holding the right one without ever
 *      re-displaying the secret itself.
 *   3. Is the encryption key for the whole-control-plane backup archive
 *      (`wrapControlPlaneArchive`/`unwrapControlPlaneArchive`) — which
 *      itself contains the control-plane `.env` (and therefore
 *      `DATA_ENCRYPTION_KEYS`/`BETTER_AUTH_SECRET`). Decrypting the archive
 *      with the recovery key on a fresh box recovers the ENTIRE keyring as a
 *      side effect of restoring `.env` — there is no separate "unwrap the
 *      keyring" ceremony to get wrong.
 *
 * Deliberately independent of `./crypto.ts` and `@otterdeploy/env/server`:
 * this module must run standalone in a context that has NEITHER the
 * platform's env vars NOR a database connection — a fresh VPS mid-restore, or
 * the `otterdeploy` CLI invoked outside the control plane entirely. It only
 * uses the Web Crypto API, which is why it also happens to be tree-shakeable
 * into the CLI bundle (see `apps/cli/src/commands/recovery-key.ts`).
 *
 * Coordinates with od-5j8.12 ("no distinct backup-recovery key" is listed
 * there as open work) — this module IS that missing piece, scoped to backup
 * archive encryption specifically. It does not touch `DATA_ENCRYPTION_KEYS`
 * key rotation, which stays od-5j8.12's territory.
 */

const KEY_BYTES = 32; // AES-256
const NONCE_BYTES = 12; // AES-GCM standard
const FINGERPRINT_PREFIX_BYTES = 4;
const MAGIC = "OTCPBK1\0"; // otterdeploy control-plane backup key, format v1

const textEncoder = new TextEncoder();

// ── key generation / formatting ──────────────────────────────────────────

/** Generate a fresh 256-bit recovery key, hex-encoded (64 lowercase hex chars).
 *  Hex (not base64url) so it survives copy/paste into shells, YAML, and
 *  password-manager fields without escaping concerns. */
export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return bytesToHex(bytes);
}

/** True iff `value` is a well-formed recovery key (64 hex chars). Does not
 *  verify it matches any particular archive — see `unwrapControlPlaneArchive`
 *  for that, which fails fast via the fingerprint check. */
export function isValidRecoveryKey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim());
}

/** Group the raw hex key into `XXXX-XXXX-...` chunks for operator-facing
 *  display (16 groups of 4). Purely cosmetic — `normalizeRecoveryKeyInput`
 *  reverses it back to the canonical 64-char hex form. */
export function formatRecoveryKeyForDisplay(key: string): string {
  const hex = key.trim().toLowerCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) groups.push(hex.slice(i, i + 4));
  return groups.join("-").toUpperCase();
}

/** Reverse `formatRecoveryKeyForDisplay` (and tolerate raw/pasted input with
 *  stray whitespace) back to canonical lowercase hex. */
export function normalizeRecoveryKeyInput(input: string): string {
  return input.replace(/[\s-]/g, "").toLowerCase();
}

/** A short, non-secret fingerprint of a recovery key — sha256, first 8 hex
 *  chars. Safe to persist server-side and display in the readiness UI: it
 *  lets an operator confirm "the key I'm holding matches what was generated"
 *  without the platform ever storing (or re-displaying) the key itself. */
export async function recoveryKeyFingerprint(key: string): Promise<string> {
  const digest = await sha256(hexToBytes(normalizeRecoveryKeyInput(key)));
  return bytesToHex(digest.slice(0, 8));
}

// ── archive encryption ───────────────────────────────────────────────────

export class RecoveryKeyMismatchError extends Error {
  constructor() {
    super(
      "recovery key does not match this archive — check the key against the printed fingerprint",
    );
    this.name = "RecoveryKeyMismatchError";
  }
}

export class ArchiveCorruptError extends Error {
  constructor(cause?: unknown) {
    super("control-plane archive is corrupt, truncated, or was tampered with");
    this.name = "ArchiveCorruptError";
    if (cause !== undefined) this.cause = cause;
  }
}

async function importAesKey(rawKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKeyBytes as unknown as ArrayBuffer,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt an arbitrary byte payload (the tarred-up control-plane archive —
 * control-plane pg_dump + data dir + Caddy state) under the recovery key.
 *
 * Framing (all fixed-width, no length-prefixing needed):
 *   magic (8 bytes) | fingerprint-prefix (4 bytes) | nonce (12 bytes) | AES-GCM(ciphertext || 16-byte tag)
 *
 * The embedded fingerprint prefix is NOT secret (it's a truncated hash, same
 * exposure as `recoveryKeyFingerprint`) — it exists purely so
 * `unwrapControlPlaneArchive` can reject a wrong key immediately with a clear
 * error, instead of a generic "GCM tag verification failed" after decrypting
 * a multi-GB archive.
 */
export async function wrapControlPlaneArchive(
  plaintext: Uint8Array,
  recoveryKey: string,
): Promise<Buffer> {
  const keyHex = normalizeRecoveryKeyInput(recoveryKey);
  if (!isValidRecoveryKey(keyHex)) {
    throw new Error("wrapControlPlaneArchive: recoveryKey must be 64 hex chars (32 bytes)");
  }
  const keyBytes = hexToBytes(keyHex);
  const fingerprintPrefix = (await sha256(keyBytes)).slice(0, FINGERPRINT_PREFIX_BYTES);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await importAesKey(keyBytes);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext as unknown as ArrayBuffer),
  );
  return Buffer.concat([
    textEncoder.encode(MAGIC),
    fingerprintPrefix,
    nonce,
    ciphertext,
  ]);
}

/** Decrypt an archive produced by `wrapControlPlaneArchive`. Throws
 *  `RecoveryKeyMismatchError` fast (before touching the bulk ciphertext) when
 *  the supplied key's fingerprint doesn't match the archive's embedded one,
 *  and `ArchiveCorruptError` if the GCM auth tag fails to verify (wrong key
 *  that happens to share a fingerprint prefix collision, truncation, or
 *  tampering). */
export async function unwrapControlPlaneArchive(
  blob: Uint8Array,
  recoveryKey: string,
): Promise<Buffer> {
  const keyHex = normalizeRecoveryKeyInput(recoveryKey);
  if (!isValidRecoveryKey(keyHex)) {
    throw new Error("unwrapControlPlaneArchive: recoveryKey must be 64 hex chars (32 bytes)");
  }
  const magicBytes = textEncoder.encode(MAGIC);
  const headerLen = magicBytes.length + FINGERPRINT_PREFIX_BYTES + NONCE_BYTES;
  if (blob.length < headerLen) {
    throw new ArchiveCorruptError(new Error("blob shorter than the fixed header"));
  }
  let offset = 0;
  const magic = blob.subarray(offset, offset + magicBytes.length);
  offset += magicBytes.length;
  if (!bytesEqual(magic, magicBytes)) {
    throw new ArchiveCorruptError(new Error("bad magic — not an otterdeploy control-plane archive"));
  }
  const embeddedFingerprint = blob.subarray(offset, offset + FINGERPRINT_PREFIX_BYTES);
  offset += FINGERPRINT_PREFIX_BYTES;
  const nonce = blob.subarray(offset, offset + NONCE_BYTES);
  offset += NONCE_BYTES;
  const ciphertext = blob.subarray(offset);

  const keyBytes = hexToBytes(keyHex);
  const expectedFingerprint = (await sha256(keyBytes)).slice(0, FINGERPRINT_PREFIX_BYTES);
  if (!bytesEqual(embeddedFingerprint, expectedFingerprint)) {
    throw new RecoveryKeyMismatchError();
  }

  const key = await importAesKey(keyBytes);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as unknown as ArrayBuffer },
      key,
      ciphertext as unknown as ArrayBuffer,
    );
    return Buffer.from(plaintext);
  } catch (cause) {
    throw new ArchiveCorruptError(cause);
  }
}

// ── byte helpers ──────────────────────────────────────────────────────────

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
