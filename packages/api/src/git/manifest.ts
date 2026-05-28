/**
 * GitHub App manifest flow — create an App through the UI without
 * touching env vars.
 *
 *   1. UI calls `git.startManifest` (oRPC). Server builds a manifest
 *      JSON (permissions, webhook URL, callback URL) and a signed state
 *      token (orgId + userId + exp), returns them.
 *
 *   2. UI assembles a form whose action is GitHub's app-creation URL
 *      and whose body holds the manifest. Auto-submits, browser leaves
 *      our origin.
 *
 *   3. Operator approves on GitHub. GitHub redirects back to our
 *      `redirect_url` with `?code=…&state=…`.
 *
 *   4. `GET /api/integrations/github/manifest/callback` runs:
 *      - Verify state (`verifyInstallState`).
 *      - POST `https://api.github.com/app-manifests/{code}/conversions`.
 *      - INSERT/UPDATE `git_provider` with the encrypted credentials.
 *      - Redirect operator to the install URL so they pick repos.
 *
 *   5. Existing install callback (`/api/integrations/github/install/
 *      callback`) syncs the installation + repos.
 *
 * Spec: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 *
 * Matches the pattern Coolify and Dokploy use — no env vars at any
 * step of the round-trip.
 */

import type { GitProviderId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitProvider } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";

import { encryptSecret } from "../lib/crypto";

import { apiBaseUrlForHost } from "./github-app";

type OrgId = OrganizationId;

/**
 * Minimum permissions + events required to read source and report build
 * status. Kept tight on purpose — operators can widen later via the
 * App's settings page on GitHub. Schema reference:
 * https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/about-the-github-app-manifest
 */
export interface GithubAppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
}

export interface StartManifestResult {
  /** Where the UI's auto-submitted form should POST to. */
  formActionUrl: string;
  /** Hidden form field value — must be POSTed under the name "manifest". */
  manifestJson: string;
}

/**
 * Builds the manifest + form action URL for a fresh App registration.
 *
 * `host` is "github.com" by default; pass a GHE host to register the App
 * on a self-hosted GitHub Enterprise instance. `accountLogin` decides
 * whether the form posts to a personal or organization namespace —
 * blank/null means "use whichever account the operator is logged in as
 * on GitHub".
 */
export function buildManifestRequest(opts: {
  state: string;
  baseUrl: string;
  host?: string;
  /** Optional org login on GitHub — POSTing to the org namespace pre-fills
   *  the owner picker for the operator. */
  accountLogin?: string | null;
  appName?: string;
}): StartManifestResult {
  const host = opts.host ?? "github.com";
  const base = opts.baseUrl.replace(/\/$/, "");
  const manifest: GithubAppManifest = {
    name: opts.appName ?? "Otterdeploy",
    url: base,
    hook_attributes: {
      url: `${base}/api/webhooks/github`,
      active: true,
    },
    redirect_url: `${base}/api/integrations/github/manifest/callback`,
    callback_urls: [`${base}/api/integrations/github/install/callback`],
    setup_url: `${base}/api/integrations/github/install/callback`,
    setup_on_update: true,
    // Per-org App, single tenant — don't list on the marketplace.
    public: false,
    // Read source, see PRs for preview branches, write check runs to
    // report build status. Webhook secret + private key are generated
    // by GitHub when the App is created from the manifest.
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "write",
      checks: "write",
    },
    default_events: [
      "push",
      "pull_request",
      "installation",
      "installation_repositories",
    ],
  };

  // POST to the org-scoped URL when we know the operator wants this App
  // under a specific org; falls back to the personal-account URL.
  const path = opts.accountLogin
    ? `/organizations/${encodeURIComponent(opts.accountLogin)}/settings/apps/new`
    : `/settings/apps/new`;
  const formActionUrl = `https://${host}${path}?state=${encodeURIComponent(opts.state)}`;

  return {
    formActionUrl,
    manifestJson: JSON.stringify(manifest),
  };
}

interface ManifestConversionResponse {
  id: number;
  slug: string;
  node_id: string;
  owner: { login: string };
  name: string;
  description: string | null;
  external_url: string;
  html_url: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
}

/**
 * Completes the manifest round-trip: exchanges the GitHub-issued temp
 * code for App credentials, encrypts the secrets, upserts the
 * `git_provider` row. Returns the install URL the operator should be
 * redirected to next.
 */
export async function completeManifestExchange(opts: {
  code: string;
  organizationId: OrgId;
  host?: string;
}): Promise<{
  providerId: GitProviderId;
  appSlug: string;
  installRedirectUrl: string;
}> {
  const host = opts.host ?? "github.com";
  const apiBase = apiBaseUrlForHost(host);

  // No auth needed — the `code` is the auth, and it's single-use.
  const res = await fetch(`${apiBase}/app-manifests/${opts.code}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub manifest exchange failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as ManifestConversionResponse;

  const [clientSecretCt, webhookSecretCt, privateKeyCt] = await Promise.all([
    encryptSecret(json.client_secret),
    encryptSecret(json.webhook_secret),
    encryptSecret(json.pem),
  ]);

  // Upsert by (orgId, kind=github) — the unique index. An org has at
  // most one GitHub App at a time; re-running the manifest flow
  // replaces credentials in place (operator deleted the App on GitHub
  // and made a new one).
  const inserted = await db
    .insert(gitProvider)
    .values({
      organizationId: opts.organizationId,
      kind: "github",
      displayName: `GitHub (${json.owner.login})`,
      host,
      externalAppId: String(json.id),
      appSlug: json.slug,
      clientId: json.client_id,
      clientSecretCiphertext: clientSecretCt,
      webhookSecretCiphertext: webhookSecretCt,
      privateKeyPemCiphertext: privateKeyCt,
    })
    .onConflictDoUpdate({
      target: [gitProvider.organizationId, gitProvider.kind],
      set: {
        displayName: `GitHub (${json.owner.login})`,
        host,
        externalAppId: String(json.id),
        appSlug: json.slug,
        clientId: json.client_id,
        clientSecretCiphertext: clientSecretCt,
        webhookSecretCiphertext: webhookSecretCt,
        privateKeyPemCiphertext: privateKeyCt,
      },
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("Failed to upsert git_provider row after manifest exchange");
  }

  // The install URL the operator hits next to actually grant the App
  // access to repos. State is rebuilt by the caller (it carries orgId
  // for the install callback).
  const installBase = host === "github.com" ? "https://github.com" : `https://${host}`;
  return {
    providerId: row.id,
    appSlug: json.slug,
    installRedirectUrl: `${installBase}/apps/${json.slug}/installations/new`,
  };
}

/** True if the org already has a GitHub provider row with App credentials
 *  populated — UI uses this to skip the manifest step and go straight to
 *  the install URL. */
export async function orgHasGithubApp(orgId: OrgId): Promise<boolean> {
  const [row] = await db
    .select({ externalAppId: gitProvider.externalAppId })
    .from(gitProvider)
    .where(
      and(
        eq(gitProvider.organizationId, orgId),
        eq(gitProvider.kind, "github"),
      ),
    )
    .limit(1);
  return Boolean(row?.externalAppId);
}
