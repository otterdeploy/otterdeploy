/**
 * GitHub App manifest flow: create an App through the UI without
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
 * No env vars at any step of the round-trip.
 */

import type { GitProviderId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitProvider } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { encryptForDomain } from "../lib/crypto";
import { apiBaseUrlForHost, ghFetch } from "./github-app";

type OrgId = OrganizationId;

/**
 * Minimum permissions + events required to read source and report build
 * status. Kept tight on purpose. Operators can widen later via the
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
  /** Hidden form field value: must be POSTed under the name "manifest". */
  manifestJson: string;
}

/**
 * Builds the manifest + form action URL for a fresh App registration.
 *
 * `host` is "github.com" by default; pass a GHE host to register the App
 * on a self-hosted GitHub Enterprise instance. `accountLogin` decides
 * whether the form posts to a personal or organization namespace:
 * blank/null means "use whichever account the operator is logged in as
 * on GitHub".
 */
export function buildManifestRequest(opts: {
  state: string;
  /** Browser-facing base for redirect/callback/setup URLs. GitHub only sends
   *  the operator's *browser* here, so it can be the local control-plane
   *  address (`.localhost` in dev), no public tunnel required. */
  baseUrl: string;
  /** Public base for `hook_attributes.url` only: GitHub's *servers* POST
   *  webhooks here, so it must be internet-reachable (a tunnel in dev).
   *  Falls back to `baseUrl` (prod is single-origin). */
  webhookBaseUrl?: string;
  host?: string;
  /** Optional org login on GitHub, POSTing to the org namespace pre-fills
   *  the owner picker for the operator. */
  accountLogin?: string | null;
  appName?: string;
}): StartManifestResult {
  const host = opts.host ?? "github.com";
  const base = opts.baseUrl.replace(/\/$/, "");
  const webhookBase = (opts.webhookBaseUrl ?? opts.baseUrl).replace(/\/$/, "");
  const manifest: GithubAppManifest = {
    name: opts.appName ?? "Otterdeploy",
    url: base,
    hook_attributes: {
      url: `${webhookBase}/api/webhooks/github`,
      active: true,
    },
    redirect_url: `${base}/api/integrations/github/manifest/callback`,
    callback_urls: [`${base}/api/integrations/github/install/callback`],
    setup_url: `${base}/api/integrations/github/install/callback`,
    setup_on_update: true,
    // Per-org App, single tenant: don't list on the marketplace.
    public: false,
    // Read source, see PRs for preview branches, write check runs to
    // report build status. Webhook secret + private key are generated
    // by GitHub when the App is created from the manifest.
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "write",
      checks: "write",
      // Commit Statuses API (`POST /repos/:o/:r/statuses/:sha`, used by
      // createCommitStatus in github-app.ts) is gated by `statuses`, a distinct
      // permission from `checks`. Without it GitHub 403s the preview build
      // status ("Resource not accessible by integration").
      statuses: "write",
      // `issue_comment` is delivered under the `issues` permission even when
      // the comment is on a pull request. GitHub models PR conversation
      // comments as issue comments. Read-only: the on-demand
      // `@otterdeploy preview` trigger only needs to see the body and the
      // author's association; it writes back through `pull_requests`.
      issues: "read",
    },
    // Only permission-backed events go here. `installation` and
    // `installation_repositories` are App-lifecycle events GitHub delivers to
    // every App automatically, listing them in a manifest is rejected
    // ("Default events unsupported / not supported by permissions"). We still
    // receive them; the install handler (handle-installation.ts) processes them.
    //
    // `issue_comment` powers the on-demand `@otterdeploy preview` trigger for
    // repositories that have not enabled automatic previews. NOTE: adding an
    // event (and the `issues` permission above) means EXISTING installations
    // must accept the updated permissions before the trigger works for them.
    // GitHub does not grant them retroactively. The feature is dark on those
    // installs until an owner approves, which is a rollout step, not a bug.
    default_events: ["push", "pull_request", "issue_comment"],
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

/**
 * The fields of GitHub's app-manifest conversion response this flow consumes
 * (the full payload also carries node_id, name, description, html_url, …).
 * Parsed, not cast: the credentials below get encrypted and persisted, so a
 * payload missing them must fail the exchange loudly rather than store junk.
 */
const manifestConversionSchema = z.object({
  id: z.number(),
  slug: z.string(),
  owner: z.object({ login: z.string() }),
  client_id: z.string(),
  client_secret: z.string(),
  webhook_secret: z.string(),
  pem: z.string(),
});

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

  // No auth needed. The `code` is the auth, and it's single-use. `host`
  // (via apiBase) may be a self-hosted GHE host the operator just typed in.
  // Goes through the shared egress policy the same as every other
  // GitHub API call (see ghFetch in ./github-app.ts).
  const res = await ghFetch(`${apiBase}/app-manifests/${opts.code}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub manifest exchange failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const parsed = manifestConversionSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(
      "GitHub manifest exchange succeeded but the response payload is missing expected App credential fields",
    );
  }
  const json = parsed.data;

  const [clientSecretCt, webhookSecretCt, privateKeyCt] = await Promise.all([
    encryptForDomain(json.client_secret, "git-secrets"),
    encryptForDomain(json.webhook_secret, "git-secrets"),
    encryptForDomain(json.pem, "git-secrets"),
  ]);

  // Upsert by (orgId, kind=github): the unique index. An org has at
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
 *  populated: UI uses this to skip the manifest step and go straight to
 *  the install URL. */
export async function orgHasGithubApp(orgId: OrgId): Promise<boolean> {
  const [row] = await db
    .select({ externalAppId: gitProvider.externalAppId })
    .from(gitProvider)
    .where(and(eq(gitProvider.organizationId, orgId), eq(gitProvider.kind, "github")))
    .limit(1);
  return Boolean(row?.externalAppId);
}
