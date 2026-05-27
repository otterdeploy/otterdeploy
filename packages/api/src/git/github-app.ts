/**
 * GitHub App auth — JWT minting + installation access token exchange.
 *
 * GitHub App authentication has two layers:
 *
 *   1. App JWT: a short-lived (≤10 min) RS256-signed JWT proving "I am the
 *      App with id X" — built from `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`.
 *
 *   2. Installation access token: a one-hour bearer token scoped to a single
 *      installation, minted by POSTing to
 *      `/app/installations/{id}/access_tokens` with the App JWT.
 *
 * We don't store either: both are minted on demand by `getInstallationToken`
 * and held only for the duration of the API call that needs them.
 *
 * Spec refs:
 *   - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app
 *   - https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
 */

import { env } from "@otterstack/env/server";
import { createError } from "evlog";

const GITHUB_API = "https://api.github.com";
const JWT_TTL_SECONDS = 9 * 60; // 9 minutes — GitHub allows up to 10.

export interface GithubAppConfig {
  appId: string;
  privateKeyPem: string;
}

export class GithubAppNotConfiguredError extends Error {
  constructor() {
    super(
      "GitHub App not configured (set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY)",
    );
    this.name = "GithubAppNotConfiguredError";
  }
}

export function loadGithubAppConfig(): GithubAppConfig {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new GithubAppNotConfiguredError();
  }
  return {
    appId: env.GITHUB_APP_ID,
    // Env vars commonly store the PEM with literal "\n" sequences instead
    // of real newlines — normalize before WebCrypto.
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}

/**
 * Mints a fresh App-level JWT. Cache lifetime is intentionally short —
 * call once per outbound request and discard.
 */
export async function mintAppJwt(config?: GithubAppConfig): Promise<string> {
  const { appId, privateKeyPem } = config ?? loadGithubAppConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 30, // 30s skew tolerance
    exp: now + JWT_TTL_SECONDS,
    iss: appId,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPkcs8PrivateKey(privateKeyPem);
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
 * Mints a short-lived installation access token. Throws if GitHub rejects
 * the App JWT or the installation has been revoked.
 */
export async function getInstallationToken(
  installationId: string,
): Promise<InstallationTokenResponse> {
  const jwt = await mintAppJwt();
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
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

/**
 * Fetches the installation row by id, including its account + permissions.
 * Used by the connect flow to populate `git_installation` after the
 * operator finishes the GitHub-side install.
 */
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

export async function lookupInstallation(
  installationId: string,
): Promise<InstallationLookup> {
  const jwt = await mintAppJwt();
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
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
 * pagination (max 100/page, walks until exhausted). Caller already has an
 * installation token from `getInstallationToken`.
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
): Promise<InstallationRepo[]> {
  const out: InstallationRepo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
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
