/**
 * Loaders that turn a `git_provider` row into a `GithubAppConfig` (the
 * thing the JWT/token helpers in `github-app.ts` consume). Kept separate
 * from the primitives so callers can pass a config without pulling
 * `@otterdeploy/db` into unit tests of the primitives.
 *
 * Three flavours, depending on what the caller knows:
 *
 *   - by provider id          — the row id itself
 *   - by installation id      — joined via `git_installation.providerId`
 *   - by external app id      — webhook routing via the
 *                                X-GitHub-Hook-Installation-Target-ID header
 *
 * Plus an "if present" variant for the org's GitHub provider, used by the
 * install callback to fail with a typed error (rather than 500) when the
 * operator skipped the manifest step.
 */

import type { GitProviderId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitProvider } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import { decryptSecret } from "../lib/crypto";
import {
  apiBaseUrlForHost,
  type GithubAppConfig,
  type GithubAppConfigWithWebhookSecret,
  GithubAppNotConfiguredError,
} from "./github-app";

type OrgId = OrganizationId;

/** Look up + decrypt by provider row id (the path most callers take). */
export async function loadGithubAppForProvider(
  providerId: GitProviderId,
): Promise<GithubAppConfig> {
  const [row] = await db.select().from(gitProvider).where(eq(gitProvider.id, providerId)).limit(1);
  if (!row) throw new GithubAppNotConfiguredError(`provider ${providerId} not found`);
  return rowToConfig(row);
}

/** Look up + decrypt by GitHub-side installation id (used by getInstallationToken). */
export async function loadGithubAppForInstallation(
  installationId: string,
): Promise<GithubAppConfig> {
  const [inst] = await db
    .select()
    .from(gitInstallation)
    .where(eq(gitInstallation.installationId, installationId))
    .limit(1);
  if (!inst) {
    throw new GithubAppNotConfiguredError(`no installation row for ${installationId}`);
  }
  return loadGithubAppForProvider(inst.providerId);
}

/** Look up by org's GitHub provider row, if any. Returns null when absent
 *  — the connect callback uses this to fail with a typed error rather than
 *  blowing up on a missing row. */
export async function loadGithubAppForOrgIfPresent(orgId: OrgId): Promise<GithubAppConfig | null> {
  const [row] = await db
    .select()
    .from(gitProvider)
    .where(and(eq(gitProvider.organizationId, orgId), eq(gitProvider.kind, "github")))
    .limit(1);
  if (!row || !row.externalAppId || !row.privateKeyPemCiphertext) return null;
  return rowToConfig(row);
}

/**
 * Look up by the App ID GitHub puts in the
 * `X-GitHub-Hook-Installation-Target-ID` webhook header. Includes the webhook
 * secret so the receiver can verify the HMAC. Indexed on externalAppId so
 * the query stays O(log n) even with many connected Apps.
 */
export async function loadGithubAppByExternalAppIdForWebhook(
  externalAppId: string,
): Promise<GithubAppConfigWithWebhookSecret | null> {
  const [row] = await db
    .select()
    .from(gitProvider)
    .where(eq(gitProvider.externalAppId, externalAppId))
    .limit(1);
  if (!row || !row.externalAppId || !row.privateKeyPemCiphertext || !row.webhookSecretCiphertext) {
    return null;
  }
  const config = await rowToConfig(row);
  const webhookSecret = await decryptSecret(row.webhookSecretCiphertext);
  return { ...config, webhookSecret, providerId: row.id };
}

async function rowToConfig(row: {
  host: string;
  externalAppId: string | null;
  privateKeyPemCiphertext: string | null;
}): Promise<GithubAppConfig> {
  if (!row.externalAppId || !row.privateKeyPemCiphertext) {
    throw new GithubAppNotConfiguredError("row missing app id or private key");
  }
  return {
    appId: row.externalAppId,
    privateKeyPem: await decryptSecret(row.privateKeyPemCiphertext),
    apiBaseUrl: apiBaseUrlForHost(row.host),
  };
}
