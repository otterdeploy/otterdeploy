/**
 * The slice of `platform_settings` the auth layer needs at request time:
 * the registration policy and the social sign-in providers.
 *
 * Why this file exists rather than importing
 * packages/api/src/lib/platform-runtime-settings.ts: `@otterdeploy/api`
 * depends on `@otterdeploy/auth`, so the import can only go this direction.
 * Same reasoning (and the same resolution) as
 * packages/jobs/src/delivery/secret-crypto.ts, which mirrors the identical v1
 * primitive for the same dependency reason.
 *
 * Only DECRYPT is mirrored here: auth reads these credentials, it never writes
 * them (the settings router in packages/api owns every write, and encrypts
 * with the byte-identical v1 construction: HKDF-SHA256 off BETTER_AUTH_SECRET
 * with a fixed salt/info, AES-256-GCM, `v1.<nonce>.<ciphertext>` base64url).
 * Because the key derives deterministically from the env secret, ciphertext
 * written over there decrypts here with no shared state.
 */

import { db } from "@otterdeploy/db";
import { user as userTbl } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { base64UrlDecode } from "@otterdeploy/shared/crypto";
import { eq } from "drizzle-orm";
import { log } from "evlog";

import type { SignInMethods } from "./sign-in-methods";

import { DEFAULT_SIGN_IN_METHODS } from "./sign-in-methods";

const V1_FORMAT = "v1";
const HKDF_INFO = "otterdeploy/secret-encryption/v1";
const HKDF_SALT = "otterdeploy-secret-salt";

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    "HKDF",
    false,
    ["deriveKey"],
  );
  cachedKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(HKDF_SALT),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

/** Null on any malformed/undecryptable blob. A provider whose secret can't be
 *  read must degrade to "not configured", which the settings UI shows and the
 *  sign-in page reflects by omitting the button: rather than throw during
 *  auth construction and take the whole install's sign-in down. */
async function decryptOrNull(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  const parts = blob.split(".");
  if (parts.length !== 3 || parts[0] !== V1_FORMAT) return null;
  const [, nonceB64, cipherB64] = parts;
  if (nonceB64 === undefined || cipherB64 === undefined) return null;
  try {
    // Copied into fresh (ArrayBuffer-backed) views: `base64UrlDecode` types
    // its result over ArrayBufferLike, which WebCrypto's BufferSource won't
    // take. Same resolution as packages/jobs/src/delivery/secret-crypto.ts.
    const nonce = new Uint8Array(base64UrlDecode(nonceB64));
    const ciphertext = new Uint8Array(base64UrlDecode(cipherB64));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      await getKey(),
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export type RegistrationPolicy = "invite-only" | "open";

export const SOCIAL_PROVIDER_IDS = ["github", "google", "gitlab"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export interface ResolvedSocialProvider {
  id: SocialProviderId;
  clientId: string;
  clientSecret: string;
  issuer?: string;
}

type PlatformRow = typeof platformSettings.$inferSelect;

async function readRow(): Promise<PlatformRow | undefined> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

/**
 * Read fresh on every signup attempt. Deliberately uncached. This is the
 * decision of whether a stranger may create an account, so an operator who
 * closes registration must have it take effect on the very next request, not
 * after a cache TTL. Signups are rare enough that the extra select is free.
 * Fails CLOSED: a DB error yields invite-only.
 */
export async function registrationPolicy(): Promise<RegistrationPolicy> {
  try {
    const row = await readRow();
    return row?.registrationMode === "open" ? "open" : "invite-only";
  } catch (error) {
    log.warn({
      auth: { event: "registration-policy-read-failed" },
      error: error instanceof Error ? error.message : String(error),
    });
    return "invite-only";
  }
}

/**
 * Registration surface the sign-in page renders:
 *   "bootstrap", no account exists yet; offer the bootstrap-token form.
 *   "open": operator allows self-registration; offer plain sign-up.
 *   "invite-only": sign-up only reachable through an invitation link.
 */
export type RegistrationMode = "bootstrap" | "invite-only" | "open";

/**
 * Reads its own columns rather than going through `readRow` because it also
 * needs to know whether ANY account exists, and "no user rows and no
 * bootstrap timestamp" is what distinguishes a fresh install from one whose
 * operator has closed registration.
 */
export async function getRegistrationMode(): Promise<RegistrationMode> {
  const [[existingUser], [installation]] = await Promise.all([
    db.select({ id: userTbl.id }).from(userTbl).limit(1),
    db
      .select({
        bootstrapCompletedAt: platformSettings.bootstrapCompletedAt,
        registrationMode: platformSettings.registrationMode,
      })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1),
  ]);
  if (!existingUser && !installation?.bootstrapCompletedAt) return "bootstrap";
  return installation?.registrationMode === "open" ? "open" : "invite-only";
}

/**
 * Which sign-in methods this installation currently accepts.
 *
 * Read fresh, uncached, for the same reason `registrationPolicy` above is: an
 * operator who turns a method off is making a security decision and must have
 * it take effect on the very next request, not after a TTL. The gate that
 * calls this only runs on the sign-in paths themselves (see
 * ./sign-in-methods.ts), so `/get-session` and the polled CLI token endpoint
 * never pay for it.
 *
 * A null column means enabled, matching the rest of `platform_settings`. Fails
 * OPEN on a database error: see DEFAULT_SIGN_IN_METHODS for why this is the
 * opposite choice from `registrationPolicy`.
 */
export async function resolveSignInMethods(): Promise<SignInMethods> {
  try {
    const row = await readRow();
    return {
      password: row?.signInPasswordEnabled ?? DEFAULT_SIGN_IN_METHODS.password,
      passkey: row?.signInPasskeyEnabled ?? DEFAULT_SIGN_IN_METHODS.passkey,
      sso: row?.signInSsoEnabled ?? DEFAULT_SIGN_IN_METHODS.sso,
    };
  } catch (error) {
    log.warn({
      auth: { event: "sign-in-methods-read-failed", fallback: "all-enabled" },
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_SIGN_IN_METHODS;
  }
}

/** Column names per provider. Must stay identical to PROVIDER_COLUMNS in
 *  packages/api/src/lib/platform-runtime-settings.ts: that module writes these
 *  columns, this one reads them. */
const PROVIDER_COLUMNS = {
  github: {
    enabled: "githubOauthEnabled",
    clientId: "githubOauthClientId",
    secret: "githubOauthClientSecretCiphertext",
  },
  google: {
    enabled: "googleOauthEnabled",
    clientId: "googleOauthClientId",
    secret: "googleOauthClientSecretCiphertext",
  },
  gitlab: {
    enabled: "gitlabOauthEnabled",
    clientId: "gitlabOauthClientId",
    secret: "gitlabOauthClientSecretCiphertext",
  },
} as const satisfies Record<
  SocialProviderId,
  { enabled: string; clientId: string; secret: string }
>;

const PROVIDER_ENV: Record<SocialProviderId, { clientId?: string; clientSecret?: string }> = {
  github: {
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
  },
  google: {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  },
  gitlab: {
    clientId: env.GITLAB_OAUTH_CLIENT_ID,
    clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
  },
};

/**
 * Env-seeded social providers, in better-auth's own shape: the set used to
 * build the FIRST auth instance, before the database is reachable.
 *
 * Derived from PROVIDER_ENV rather than spelled out a second time in
 * ./index.ts, where it used to live. The two lists read the same six env vars,
 * and a provider present in one but not the other would be a provider that
 * works at boot and vanishes on the first `reloadAuth()`, or the reverse.
 *
 * A provider is included only when BOTH halves of its credential are present,
 * so an unconfigured one is a clean no-op rather than a broken button.
 */
export function envSocialProviders(): Record<
  string,
  { clientId: string; clientSecret: string; issuer?: string }
> {
  const out: Record<string, { clientId: string; clientSecret: string; issuer?: string }> = {};
  for (const id of SOCIAL_PROVIDER_IDS) {
    const { clientId, clientSecret } = PROVIDER_ENV[id];
    if (!clientId || !clientSecret) continue;
    const issuer = id === "gitlab" ? env.GITLAB_OAUTH_ISSUER : undefined;
    out[id] = { clientId, clientSecret, ...(issuer ? { issuer } : {}) };
  }
  return out;
}

function stored(row: PlatformRow | undefined, id: SocialProviderId) {
  const col = PROVIDER_COLUMNS[id];
  return {
    enabled: row?.[col.enabled] ?? null,
    clientId: row?.[col.clientId] ?? null,
    secretBlob: row?.[col.secret] ?? null,
    // Only GitLab has an instance URL; the others are always the vendor's.
    issuer: id === "gitlab" ? (row?.gitlabOauthIssuer ?? env.GITLAB_OAUTH_ISSUER ?? null) : null,
  };
}

/**
 * Providers to register with better-auth. A provider is included only when it
 * is enabled AND carries both halves of its credential, so a half-configured
 * provider is skipped rather than registered broken. The sign-in page mirrors
 * this exact list, so it can never render a button that dead-ends.
 *
 * `enabled === null` (never touched in the UI) counts as enabled, which is what
 * keeps an install that configured SSO purely through env working unchanged
 * after this table shipped.
 *
 * Never throws: on a DB error it falls back to the env-configured set, so a
 * transient Postgres blip degrades to the pre-existing behaviour instead of
 * dropping every SSO button.
 */
export async function resolveSocialProviders(): Promise<ResolvedSocialProvider[]> {
  let row: PlatformRow | undefined;
  try {
    row = await readRow();
  } catch (error) {
    log.warn({
      auth: { event: "social-providers-read-failed", fallback: "env" },
      error: error instanceof Error ? error.message : String(error),
    });
    row = undefined;
  }

  const resolved: ResolvedSocialProvider[] = [];
  for (const id of SOCIAL_PROVIDER_IDS) {
    const saved = stored(row, id);
    if (saved.enabled === false) continue;
    const seed = PROVIDER_ENV[id];
    const clientId = saved.clientId ?? seed.clientId ?? null;
    const clientSecret = (await decryptOrNull(saved.secretBlob)) ?? seed.clientSecret ?? null;
    if (!clientId || !clientSecret) continue;
    resolved.push({
      id,
      clientId,
      clientSecret,
      ...(saved.issuer ? { issuer: saved.issuer } : {}),
    });
  }
  return resolved;
}

/** better-auth's `socialProviders` shape, built from the resolved list. */
export function toBetterAuthSocialProviders(
  providers: ResolvedSocialProvider[],
): Record<string, { clientId: string; clientSecret: string; issuer?: string }> {
  return Object.fromEntries(
    providers.map((p) => [
      p.id,
      {
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        ...(p.issuer ? { issuer: p.issuer } : {}),
      },
    ]),
  );
}
