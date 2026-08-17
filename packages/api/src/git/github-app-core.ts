/**
 * GitHub App auth primitives: JWT minting + installation access token
 * exchange. Pure functions: take an explicit `GithubAppConfig` (declared and
 * loaded by `github-app-config.ts`) and do no DB access of their own, so
 * they can be unit-tested without a row. Leaf module: `github-app.ts` is the
 * barrel that stitches this together with the repos/write-back siblings.
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

import { base64UrlEncode } from "@otterdeploy/shared/crypto";
import { egressFetch, EgressPolicyError } from "@otterdeploy/shared/egress-policy";
import { TaggedError } from "better-result";
import { createError } from "evlog";
import { createPrivateKey, createSign } from "node:crypto";
import * as z from "zod";

import { controlPlaneEgressDenylist } from "../lib/egress-denylist";
import { egressAllowlist } from "../lib/egress-options";
import { type GithubAppConfig, loadGithubAppForInstallation } from "./github-app-config";

const JWT_TTL_SECONDS = 9 * 60; // 9 minutes: GitHub allows up to 10.
const GITHUB_FETCH_TIMEOUT_MS = 15_000;
const GITHUB_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * `config.apiBaseUrl` embeds `git_provider.host`: tenant-configurable for
 * a self-hosted GitHub Enterprise Server install (`apiBaseUrlForHost`
 * below). Every call to GitHub's API goes through the shared egress
 * policy: resolve + validate every address, deny loopback/private/
 * link-local/metadata ranges (and the control plane's own identity)
 * unconditionally by default, and pin the connection to the validated
 * address. See packages/shared/src/egress-policy.ts.
 */
export async function ghFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}> {
  const denylist = await controlPlaneEgressDenylist();
  try {
    return await egressFetch(url, init, {
      timeoutMs: GITHUB_FETCH_TIMEOUT_MS,
      maxBytes: GITHUB_MAX_RESPONSE_BYTES,
      maxRedirects: 5,
      denyHosts: denylist.blockedHosts,
      denyAddresses: denylist.blockedAddresses,
      allowAddresses: await egressAllowlist(),
    });
  } catch (err) {
    if (err instanceof EgressPolicyError) {
      throw createError({
        message: `GitHub API request blocked by outbound egress policy: ${err.message}`,
        status: 502,
      });
    }
    throw err;
  }
}

/**
 * GitHub returned 404 for an installation we have on record. It was
 * uninstalled, suspended past recovery, or belongs to a different App. The
 * only fix is to reinstall the App, so callers surface this as an actionable
 * "reinstall required" error rather than a generic 5xx.
 */
export class GithubInstallationInvalidError extends TaggedError("GithubInstallationInvalidError")<{
  message: string;
}>() {
  constructor() {
    super({
      message:
        "GitHub no longer recognizes this installation: reinstall the GitHub App to reconnect.",
    });
  }
}

/**
 * Mints a fresh App-level JWT. Cache lifetime is intentionally short.
 * Call once per outbound request and discard.
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

  // GitHub issues App private keys in PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`).
  // node:crypto's createPrivateKey accepts both PKCS#1 and PKCS#8; WebCrypto's
  // importKey("pkcs8", …) rejects PKCS#1 with "Data provided to an operation does
  // not meet requirements", so the RS256 signature is produced via node:crypto.
  const key = createPrivateKey(config.privateKeyPem);
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const sigB64 = base64UrlEncode(new Uint8Array(signer.sign(key)));
  return `${signingInput}.${sigB64}`;
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repository_selection?: "all" | "selected";
}

/** GitHub responses are parsed at the boundary, never cast. Only the fields we
 *  consume are declared; zod strips the rest. */
const installationTokenResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  permissions: z.record(z.string(), z.string()).optional(),
  repository_selection: z.enum(["all", "selected"]).optional(),
}) satisfies z.ZodType<InstallationTokenResponse>;

/** Parse a GitHub JSON body against `schema`; a shape mismatch surfaces as the
 *  same 502 upstream error a malformed status would. Exported for the sibling
 *  modules split out of this file (repos / write-back). */
export function parseGithubResponse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      message: `GitHub returned an unexpected ${what} payload`,
      status: 502,
    });
  }
  return parsed.data;
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
  const res = await ghFetch(
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
    // 404 = GitHub no longer has this installation (uninstalled / revoked /
    // owned by a different App). Surface it as a typed, actionable error the
    // router maps to a reinstall prompt instead of a generic 5xx.
    if (res.status === 404) throw new GithubInstallationInvalidError();
    throw createError({
      message: `GitHub rejected installation token request (${res.status})`,
      status: 502,
      why: body.slice(0, 500),
    });
  }
  return parseGithubResponse(
    installationTokenResponseSchema,
    await res.json(),
    "installation token",
  );
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

const installationLookupSchema = z.object({
  id: z.number(),
  account: z.object({
    id: z.number(),
    login: z.string(),
    type: z.string(),
    avatar_url: z.string(),
  }),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string(), z.string()),
  app_id: z.number(),
}) satisfies z.ZodType<InstallationLookup>;

/**
 * Fetches the installation row by id. Takes an explicit `config` because
 * the install callback runs BEFORE we've persisted a `git_installation`
 * row, so loadGithubAppForInstallation would 404. The caller (connect.ts)
 * loads the config from the org's provider row directly.
 */
export async function lookupInstallation(
  installationId: string,
  config: GithubAppConfig,
): Promise<InstallationLookup> {
  const jwt = await mintAppJwt(config);
  const res = await ghFetch(`${config.apiBaseUrl}/app/installations/${installationId}`, {
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
  return parseGithubResponse(installationLookupSchema, await res.json(), "installation lookup");
}
