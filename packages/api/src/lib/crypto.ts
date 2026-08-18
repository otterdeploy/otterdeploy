/**
 * Symmetric encryption for at-rest secrets: registry passwords, SSH
 * private keys, custom certificate keys, GitHub App credentials, sealed
 * env vars, and anything else we wouldn't want to read out of a DB dump.
 *
 * ── Two ciphertext formats live side by side ──────────────────────────
 *
 * v1 (legacy, `encryptSecret` / `decryptSecret`): every domain shared ONE
 * key, HKDF-derived from `BETTER_AUTH_SECRET` with a single fixed info
 * string. Kept byte-for-byte unchanged so every ciphertext written before
 * this module's v2 rework keeps decrypting forever. See `decryptSecret`.
 *
 * v2 (`encryptForDomain` / `decryptForDomain`): domain-separated: each
 * purpose (ssh-keys, registry-creds, certs, git-secrets, env-vars,
 * server-secrets, db-creds. See `SecretDomain`) gets its OWN HKDF-derived
 * key, so a compromised or rotated key for one domain can't be replayed
 * against another domain's ciphertext (the AES-GCM auth tag simply won't
 * verify: see the "cross-domain" test in crypto.test.ts). Each key also
 * carries a `keyId` into a keyring (`DATA_ENCRYPTION_KEYS`), so the master
 * secret itself can rotate without invalidating old ciphertext: old rows
 * keep decrypting off their embedded keyId, new writes use the current one.
 * See `docs/designs/encryption-rotation.md` for the operator-facing
 * rotation procedure and `packages/api/scripts/rotate-encryption-keys.ts`
 * for the rotate command.
 *
 * Ciphertext layouts (both base64url, no padding) live in ./crypto-envelope,
 * which builds and parses them:
 *
 *     v1.<nonce>.<ciphertext_with_tag>
 *     v2:<domain>:<keyId>:<nonce>:<ciphertext_with_tag>
 *
 *   - nonce: 12 random bytes (AES-GCM standard). Fresh per call, never
 *     reuse a nonce with the same key.
 *   - ciphertext_with_tag: AES-GCM output (ciphertext || 16-byte tag).
 *
 * ── Keyring / boot-time validation ─────────────────────────────────────
 *
 * The keyring is built ONCE, eagerly, at module import (not lazily on
 * first use). A missing/short master key throws immediately when the
 * server boots (any router that imports this module, directly or
 * transitively, fails to start), rather than surfacing as a confusing
 * 500 on the first encrypt call. See `buildKeyringFrom`.
 */

import { env } from "@otterdeploy/env/server";

import {
  formatV1Envelope,
  formatV2Envelope,
  isV1Format,
  isV2Format,
  parseV1Envelope,
  parseV2Envelope,
} from "./crypto-envelope";

const NONCE_BYTES = 12;
const LEGACY_HKDF_INFO = "otterdeploy/secret-encryption/v1";
const LEGACY_HKDF_SALT = "otterdeploy-secret-salt";

/** Master key material shorter than this is refused outright. Same floor
 *  as BETTER_AUTH_SECRET's own zod validation (`z.string().min(32)`). */
export const MIN_KEY_MATERIAL_BYTES = 32;

/**
 * Independently-keyed purposes. Compromising (or needing to rotate) one
 * domain's derived key never affects another's. Each is HKDF-derived from
 * the keyring's master secret with a domain-specific `info` label.
 *
 * `db-creds` is declared for forward compatibility (database_resource
 * passwords) but not yet wired to storage: see the rollout notes in
 * od-5j8.12's closing report. Everything else here IS wired to a real
 * column.
 */
export const SECRET_DOMAINS = [
  "env-vars",
  "ssh-keys",
  "registry-creds",
  "git-secrets",
  "certs",
  "db-creds",
  "server-secrets",
  // Private-networking provider credentials: the org's NetBird PAT /
  // Tailscale OAuth client secret on the `mesh_network` row. Domain-separated
  // from "server-secrets" (which is ephemeral, job-payload-lifetime material)
  // because these are long-lived and grant API control of the org's whole VPN.
  "mesh-creds",
  // External secret-manager credentials: the Vault token / Infisical client
  // secret / Doppler service token on `vault_provider` rows. Long-lived and
  // able to read every secret the org points at otterdeploy, so it gets its
  // own domain for the same reason "mesh-creds" does.
  "vault-creds",
] as const;
export type SecretDomain = (typeof SECRET_DOMAINS)[number];

const SECRET_DOMAIN_NAMES: readonly string[] = SECRET_DOMAINS;

function isSecretDomain(value: string): value is SecretDomain {
  return SECRET_DOMAIN_NAMES.includes(value);
}

/**
 * Parses the optional `DATA_ENCRYPTION_KEYS` keyring env var
 * (`id:secret,id:secret,...`) and always guarantees a `"1"` entry, falling
 * back to `BETTER_AUTH_SECRET` when the operator hasn't provisioned a
 * dedicated data-encryption master key yet (zero-config default; still a
 * real security improvement over v1 because every *domain* still gets its
 * own derived key even when they all trace back to one root secret).
 *
 * A pure function (no module-level state) so it's directly testable for
 * the "missing/short master key fails closed at boot" requirement without
 * needing to reboot the whole env module.
 *
 * Throws (fails closed) when:
 *   - an entry is malformed (no `:`), has an empty id, or is a duplicate id
 *   - any key's secret is shorter than `MIN_KEY_MATERIAL_BYTES`
 *   - no `DATA_ENCRYPTION_KEYS` is set AND `BETTER_AUTH_SECRET` is missing
 *     or too short (mirrors its own zod floor, defense in depth)
 */
export function buildKeyringFrom(vars: {
  BETTER_AUTH_SECRET?: string | null;
  DATA_ENCRYPTION_KEYS?: string | null;
}): Map<string, string> {
  const keyring = new Map<string, string>();
  const raw = vars.DATA_ENCRYPTION_KEYS;
  if (raw && raw.trim().length > 0) {
    for (const entry of raw.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(":");
      if (sep === -1) {
        throw new Error(
          `crypto: DATA_ENCRYPTION_KEYS entry "${trimmed}" is malformed. Expected "id:secret"`,
        );
      }
      const id = trimmed.slice(0, sep).trim();
      const secret = trimmed.slice(sep + 1).trim();
      if (!id) {
        throw new Error(`crypto: DATA_ENCRYPTION_KEYS entry "${trimmed}" has an empty key id`);
      }
      if (secret.length < MIN_KEY_MATERIAL_BYTES) {
        throw new Error(
          `crypto: DATA_ENCRYPTION_KEYS key id "${id}" is ${secret.length} chars, refusing to boot with ` +
            `master key material shorter than ${MIN_KEY_MATERIAL_BYTES} bytes`,
        );
      }
      if (keyring.has(id)) {
        throw new Error(`crypto: DATA_ENCRYPTION_KEYS has a duplicate key id "${id}"`);
      }
      keyring.set(id, secret);
    }
  }

  if (!keyring.has("1")) {
    const fallback = vars.BETTER_AUTH_SECRET;
    if (!fallback || fallback.length < MIN_KEY_MATERIAL_BYTES) {
      throw new Error(
        'crypto: no DATA_ENCRYPTION_KEYS key id "1" configured and BETTER_AUTH_SECRET is missing or ' +
          `shorter than ${MIN_KEY_MATERIAL_BYTES} chars, refusing to boot with weak encryption key material`,
      );
    }
    keyring.set("1", fallback);
  }

  return keyring;
}

/**
 * Which key id NEW v2 encryptions use. Defaults to `"1"`; set
 * `DATA_ENCRYPTION_KEY_ID` to cut new writes over to a freshly-added
 * keyring entry (the rotation procedure's second step).
 */
export function resolveCurrentKeyId(
  keyring: Map<string, string>,
  configured: string | null | undefined,
): string {
  const wanted = configured?.trim();
  if (!wanted) return "1";
  if (!keyring.has(wanted)) {
    throw new Error(
      `crypto: DATA_ENCRYPTION_KEY_ID="${wanted}" has no matching entry in DATA_ENCRYPTION_KEYS`,
    );
  }
  return wanted;
}

// Built eagerly at module import. See the module doc comment above.
const keyring = buildKeyringFrom({
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  DATA_ENCRYPTION_KEYS: env.DATA_ENCRYPTION_KEYS,
});
const CURRENT_KEY_ID = resolveCurrentKeyId(keyring, env.DATA_ENCRYPTION_KEY_ID);

export function currentKeyId(): string {
  return CURRENT_KEY_ID;
}

/**
 * Keyring master secrets ordered CURRENT-FIRST (the id new encryptions use,
 * then every other configured id). Consumers that derive deterministic
 * passwords from master material (the rustic repo passwords in
 * backups/rustic.ts) use this to open repos keyed under a previous secret and
 * migrate them forward: the missing rotation path for `BETTER_AUTH_SECRET`.
 * Secrets, handle with the same care as the keyring itself.
 */
export function masterSecretCandidates(): string[] {
  const ordered = [keyring.get(CURRENT_KEY_ID), ...keyring.values()];
  return [...new Set(ordered.filter((s): s is string => s != null))];
}

// ── Key derivation ──────────────────────────────────────────────────────

const derivedKeyCache = new Map<string, CryptoKey>();
let legacyKeyCache: CryptoKey | null = null;

async function importMaster(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
}

/** The original v1 key: HKDF(BETTER_AUTH_SECRET) with the fixed v1 salt/info.
 *  Deliberately independent of the keyring: even if an operator repoints
 *  keyring id "1" at different material, existing v1 ciphertext (which
 *  predates the keyring entirely) must keep decrypting off the raw env var. */
async function getLegacyKey(): Promise<CryptoKey> {
  if (legacyKeyCache) return legacyKeyCache;
  const base = await importMaster(env.BETTER_AUTH_SECRET);
  legacyKeyCache = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(LEGACY_HKDF_SALT),
      info: new TextEncoder().encode(LEGACY_HKDF_INFO),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return legacyKeyCache;
}

async function getDomainKey(domain: SecretDomain, keyId: string): Promise<CryptoKey> {
  const cacheKey = `${keyId}:${domain}`;
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;
  const secret = keyring.get(keyId);
  if (!secret) {
    throw new Error(`crypto: unknown key id "${keyId}", not present in the keyring`);
  }
  const base = await importMaster(secret);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // Domain separation: same IKM (per keyId) can derive N independent
      // keys by varying `info`. Salt is keyed off the key id so rotating
      // in a brand new master secret under a new id can never collide with
      // an old id's derived keys even if two operators reused the same
      // secret bytes for both (paranoid, but free).
      salt: new TextEncoder().encode(`otterdeploy/v2/key-${keyId}`),
      info: new TextEncoder().encode(`otterdeploy/domain/${domain}`),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  derivedKeyCache.set(cacheKey, key);
  return key;
}

// ── AES-GCM ─────────────────────────────────────────────────────────────
//
// The raw seal/open both envelope versions run. Only the key and the envelope
// framing differ between v1 and v2: the cipher, the nonce size, and the
// "fresh nonce per call" rule must NOT, so they live in one place. Nonce reuse
// under a single key is the failure mode that breaks GCM outright.

async function seal(
  key: CryptoKey,
  plaintext: string,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { nonce, ciphertext: new Uint8Array(ciphertext) };
}

async function open(key: CryptoKey, nonce: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  // DOM's BufferSource only admits ArrayBuffer-backed views, while the
  // envelope decoder types its output over ArrayBufferLike. Re-wrapping
  // copies the (small) bytes into fresh ArrayBuffer-backed views, proving
  // the backing instead of asserting it.
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) },
    key,
    new Uint8Array(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

// ── v1 (legacy, unchanged) ──────────────────────────────────────────────

export async function encryptSecret(plaintext: string): Promise<string> {
  const { nonce, ciphertext } = await seal(await getLegacyKey(), plaintext);
  return formatV1Envelope(nonce, ciphertext);
}

export async function decryptSecret(blob: string): Promise<string> {
  const { nonce, ciphertext } = parseV1Envelope(blob);
  return open(await getLegacyKey(), nonce, ciphertext);
}

// ── v2 (domain-separated + versioned) ───────────────────────────────────

/** Encrypt `plaintext` for `domain` under the current key id. */
export async function encryptForDomain(plaintext: string, domain: SecretDomain): Promise<string> {
  const key = await getDomainKey(domain, CURRENT_KEY_ID);
  const { nonce, ciphertext } = await seal(key, plaintext);
  return formatV2Envelope(domain, CURRENT_KEY_ID, nonce, ciphertext);
}

/**
 * Decrypt a ciphertext that was encrypted `forDomain`. Transparently
 * handles both formats:
 *
 *   - v1 (legacy): predates domain separation entirely, so it's treated as
 *     universally valid for any `domain` the caller asserts: this is the
 *     "backward-compatible v1 decryption" contract. Once re-encrypted
 *     (rotation, or any normal write path), it becomes a real v2 envelope
 *     and the domain check below applies for good.
 *   - v2: the envelope's OWN `domain` field must match what the caller
 *     expects, or this throws. An attacker (or a bug) that feeds a
 *     registry-creds ciphertext into the ssh-keys decrypt path gets a clean
 *     rejection, not silent cross-domain decryption. Because the domain is
 *     baked into the HKDF `info` label, even a blob with a *forged* domain
 *     field decrypts to garbage / fails the GCM tag. The check here is a
 *     fast, readable rejection on top of that cryptographic guarantee.
 */
export async function decryptForDomain(blob: string, domain: SecretDomain): Promise<string> {
  if (isV1Format(blob)) {
    return decryptSecret(blob);
  }
  if (!isV2Format(blob)) {
    throw new Error("decryptForDomain: malformed ciphertext (unrecognized format)");
  }
  const parsed = parseV2Envelope(blob);
  // Unknown-domain first: it checks the raw envelope string (and narrows it to
  // SecretDomain for getDomainKey); a garbage domain reports as unknown rather
  // than as a mismatch against whatever the caller expected.
  if (!isSecretDomain(parsed.domain)) {
    throw new Error(`decryptForDomain: unknown domain "${parsed.domain}" in envelope`);
  }
  if (parsed.domain !== domain) {
    throw new Error(
      `decryptForDomain: domain mismatch (envelope="${parsed.domain}", expected="${domain}")`,
    );
  }
  const key = await getDomainKey(parsed.domain, parsed.keyId);
  return open(key, parsed.nonce, parsed.ciphertext);
}

/** The key id a ciphertext was encrypted under. `"1"` for v1 (it predates
 *  the keyring, and keyring id "1" is always BETTER_AUTH_SECRET-derived.
 *  See `buildKeyringFrom`, so treating v1 as id "1" is at least
 *  key-material-consistent even though v1 uses its own fixed salt/info). */
export function envelopeKeyId(blob: string): string {
  if (isV1Format(blob)) return "1";
  if (isV2Format(blob)) return parseV2Envelope(blob).keyId;
  throw new Error("envelopeKeyId: malformed ciphertext (unrecognized format)");
}

/**
 * Rotation primitive: decrypt `blob` (v1 or v2, either transparently) and,
 * if it isn't already a v2 envelope under the CURRENT key id, re-encrypt it
 * under the current key id for `domain`. Returns the original blob
 * unchanged (and `rotated: false`) when there's nothing to do, so callers
 * (the rotate script, or a lazy re-encrypt-on-write) can skip a DB write.
 */
export async function rotateForDomain(
  blob: string,
  domain: SecretDomain,
): Promise<{ value: string; rotated: boolean }> {
  const plaintext = await decryptForDomain(blob, domain);
  if (isV2Format(blob)) {
    const parsed = parseV2Envelope(blob);
    if (parsed.domain === domain && parsed.keyId === CURRENT_KEY_ID) {
      return { value: blob, rotated: false };
    }
  }
  return { value: await encryptForDomain(plaintext, domain), rotated: true };
}
