/**
 * Social sign-in provider settings (platform-wide singleton). Split out of
 * ./runtime-settings.ts for size.
 *
 * Saving a provider rebuilds the better-auth instance — `socialProviders` is
 * read when the instance is constructed, so nothing short of a swap applies a
 * credential change. That means a provider goes live on the next request with
 * no server restart, and (because the sign-in page reads the live list from
 * /api/auth/public-config) no SPA rebuild either.
 *
 * Secrets are write-only, matching the email transport: a string sets it, null
 * clears it, omitting it leaves it alone, and reads only ever return a
 * `secretConfigured` boolean.
 */

import { enabledSocialProviderIds, reloadAuth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";

import { encryptSecret } from "../../lib/crypto";
import {
  invalidatePlatformRuntimeSettings,
  SOCIAL_PROVIDER_IDS,
  type SocialProviderId,
} from "../../lib/platform-runtime-settings";

type PlatformRow = typeof platformSettings.$inferSelect;
type PlatformInsert = typeof platformSettings.$inferInsert;

export interface SocialProviderView {
  id: SocialProviderId;
  /** Null = never toggled here ⇒ enabled whenever credentials resolve, which
   *  is what keeps a pre-existing env-only install working untouched. */
  enabled: boolean | null;
  clientId: string | null;
  secretConfigured: boolean;
  issuer: string | null;
  envConfigured: boolean;
  live: boolean;
}

/** Must stay identical to PROVIDER_COLUMNS in
 *  packages/api/src/lib/platform-runtime-settings.ts (the read path). */
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
} as const satisfies Record<SocialProviderId, { enabled: string; clientId: string; secret: string }>;

const PROVIDER_ENV: Record<SocialProviderId, { clientId?: string; clientSecret?: string }> = {
  github: { clientId: env.GITHUB_OAUTH_CLIENT_ID, clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET },
  google: { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET },
  gitlab: { clientId: env.GITLAB_OAUTH_CLIENT_ID, clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET },
};

async function readRow(): Promise<PlatformRow | undefined> {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row;
}

function toProviderView(row: PlatformRow | undefined, id: SocialProviderId): SocialProviderView {
  const col = PROVIDER_COLUMNS[id];
  const seed = PROVIDER_ENV[id];
  return {
    id,
    enabled: row?.[col.enabled] ?? null,
    clientId: row?.[col.clientId] ?? null,
    secretConfigured: Boolean(row?.[col.secret]),
    issuer: id === "gitlab" ? (row?.gitlabOauthIssuer ?? env.GITLAB_OAUTH_ISSUER ?? null) : null,
    envConfigured: Boolean(seed.clientId && seed.clientSecret),
    // Deliberately NOT derived from the columns: this reports what the LIVE
    // auth instance registered, so a provider whose secret won't decrypt — or
    // one saved while a reload failed — reads as off here instead of claiming
    // to work while its sign-in button is absent.
    live: enabledSocialProviderIds().includes(id),
  };
}

export async function listSocialProviders(): Promise<SocialProviderView[]> {
  const row = await readRow();
  return SOCIAL_PROVIDER_IDS.map((id) => toProviderView(row, id));
}

export interface SaveSocialProviderInput {
  id: SocialProviderId;
  enabled: boolean;
  clientId: string | null;
  /** undefined ⇒ unchanged; null ⇒ clear; string ⇒ set (encrypted). */
  clientSecret?: string | null;
  issuer?: string | null;
}

export async function saveSocialProvider(
  input: SaveSocialProviderInput,
): Promise<SocialProviderView[]> {
  const col = PROVIDER_COLUMNS[input.id];
  const set: Partial<PlatformInsert> = {
    [col.enabled]: input.enabled,
    [col.clientId]: input.clientId,
  };
  if (input.clientSecret !== undefined) {
    set[col.secret] = input.clientSecret ? await encryptSecret(input.clientSecret) : null;
  }
  if (input.id === "gitlab" && input.issuer !== undefined) {
    set.gitlabOauthIssuer = input.issuer;
  }

  await db
    .insert(platformSettings)
    .values({ id: PLATFORM_SETTINGS_ID, ...set })
    .onConflictDoUpdate({ target: platformSettings.id, set });
  invalidatePlatformRuntimeSettings();

  // Swap the auth instance so the change binds on the next request. Never
  // throws: on failure the previous instance keeps serving and the `live` flag
  // in the returned view reports that honestly.
  await reloadAuth();
  return listSocialProviders();
}
