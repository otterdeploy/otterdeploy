/**
 * GitHub App auth primitives — JWT minting + installation access token
 * exchange. Pure functions: take an explicit `GithubAppConfig` (loaded by
 * the helpers in `github-app-config.ts`) and do no DB access of their own,
 * so they can be unit-tested without a row.
 *
 * GitHub App authentication has two layers:
 *
 *   1. App JWT: a short-lived (≤10 min) RS256-signed JWT proving "I am the
 *      App with id X".
 *
 *   2. Installation access token: a one-hour bearer token scoped to a
 *      single installation, minted by POSTing to
 *      `/app/installations/{id}/access_tokens` with the App JWT.
 *
 * We don't store either: both are minted on demand and held only for the
 * duration of the API call that needs them. App credentials live encrypted
 * on `git_provider` rows (manifest flow creates them through the UI; no
 * env vars).
 *
 * Spec refs:
 *   - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app
 *   - https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
 */

import type { GitProviderId } from "@otterdeploy/shared/id";

import { createError } from "evlog";

import {
  loadGithubAppForInstallation,
} from "./github-app-config";

const JWT_TTL_SECONDS = 9 * 60; // 9 minutes — GitHub allows up to 10.

/**
 * Everything needed to authenticate as a specific GitHub App. Loaded from a
 * `git_provider` row; the helpers in `github-app-config.ts` produce one per
 * call so secrets stay in memory only for the duration of an API call.
 */
export interface GithubAppConfig {
  /** Numeric App ID GitHub assigns (stored as text — GitHub returns it stringified). */
  appId: string;
  /** PEM-encoded RSA private key for signing App JWTs. */
  privateKeyPem: string;
  /** Resolved API base — github.com → api.github.com; GHE → {host}/api/v3. */
  apiBaseUrl: string;
}

/** App config plus webhook secret — only loaded by the webhook receiver. */
export interface GithubAppConfigWithWebhookSecret extends GithubAppConfig {
  webhookSecret: string;
  /** Provider id, surfaced so the webhook handler can scope its logging. */
  providerId: GitProviderId;
}

export class GithubAppNotConfiguredError extends Error {
  constructor(reason?: string) {
    super(
      `GitHub App not configured${reason ? ` (${reason})` : ""} — create one via the manifest flow in Settings → Git Providers`,
    );
    this.name = "GithubAppNotConfiguredError";
  }
}

/** github.com → api.github.com; GHE host → host/api/v3. Exported so the
 *  config loaders can build the URL without re-deriving the rule. */
export function apiBaseUrlForHost(host: string): string {
  if (host === "github.com") return "https://api.github.com";
  return `https://${host}/api/v3`;
}

/**
 * Mints a fresh App-level JWT. Cache lifetime is intentionally short —
 * call once per outbound request and discard.
 */
export async function mintAppJwt(config: GithubAppConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 30, // 30s skew tolerance
    exp: now + JWT_TTL_SECONDS,
    iss: config.appId,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPkcs8PrivateKey(config.privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(signingInput),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repository_selection?: "all" | "selected";
}

/**
 * Mints a short-lived installation access token. Looks up the App config
 * via the installation row, so callers only need the GitHub-side
 * installation id.
 */
export async function getInstallationToken(
  installationId: string,
): Promise<InstallationTokenResponse> {
  const config = await loadGithubAppForInstallation(installationId);
  const jwt = await mintAppJwt(config);
  const res = await fetch(
    `${config.apiBaseUrl}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw createError({
      message: `GitHub rejected installation token request (${res.status})`,
      status: 502,
      why: body.slice(0, 500),
    });
  }
  return (await res.json()) as InstallationTokenResponse;
}

export interface InstallationLookup {
  id: number;
  account: {
    id: number;
    login: string;
    type: string;
    avatar_url: string;
  };
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  app_id: number;
}

/**
 * Fetches the installation row by id. Takes an explicit `config` because
 * the install callback runs BEFORE we've persisted a `git_installation`
 * row — so loadGithubAppForInstallation would 404. The caller (connect.ts)
 * loads the config from the org's provider row directly.
 */
export async function lookupInstallation(
  installationId: string,
  config: GithubAppConfig,
): Promise<InstallationLookup> {
  const jwt = await mintAppJwt(config);
  const res = await fetch(
    `${config.apiBaseUrl}/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw createError({
      message: `GitHub installation lookup failed (${res.status})`,
      status: res.status === 404 ? 404 : 502,
      why: body.slice(0, 500),
    });
  }
  return (await res.json()) as InstallationLookup;
}

/**
 * Lists the repos accessible to the installation. Handles GitHub's
 * pagination (max 100/page, walks until exhausted). Caller already has
 * both the App config (for the API base URL) and an installation token.
 */
export interface InstallationRepo {
  id: number;
  node_id: string;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
}

export async function listInstallationRepos(
  installationToken: string,
  config: GithubAppConfig,
): Promise<InstallationRepo[]> {
  const out: InstallationRepo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${config.apiBaseUrl}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw createError({
        message: `GitHub repos list failed (${res.status})`,
        status: 502,
        why: body.slice(0, 500),
      });
    }
    const json = (await res.json()) as {
      total_count: number;
      repositories: InstallationRepo[];
    };
    out.push(...json.repositories);
    if (json.repositories.length < 100) break;
    page++;
    if (page > 50) break; // safety stop — 5k repos is plenty
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = base64Decode(body);
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
