/**
 * GitLab sign-in must not take over an existing account.
 *
 * Drives the REAL configured auth instance (`@otterdeploy/auth`) through the
 * OAuth flow: `POST /sign-in/social`, then the callback with the state cookie
 * and an authorization code. GitLab's token endpoint and `/api/v4/user` (with
 * GitLab's `confirmed_at` and no `email_verified`) are stood in for at
 * `fetch`, for gitlab.com (no issuer configured) and for a self-managed
 * issuer.
 *
 * Before the fix GitLab was a trusted linking provider, so every case below
 * linked the GitLab identity onto the existing otterdeploy user with that
 * email, including an unconfirmed email and any email on a self-managed
 * instance. Now only gitlab.com with a confirmed email may link implicitly.
 */
import { auth, reloadAuth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { account, user } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as z from "zod";

import { uniq } from "../postgres-seed";

const CLIENT_ID = "gitlab-client-id";
const APP_ORIGIN = "http://localhost:3000";
const CALLBACK = `${APP_ORIGIN}/api/auth/callback/gitlab`;
const SELF_MANAGED = "https://gitlab.selfmanaged.test";

vi.hoisted(() => {
  /* oxlint-disable node/no-process-env -- test env boundary: GitLab credentials must be in the env before @otterdeploy/env evaluates it */
  process.env.GITLAB_OAUTH_CLIENT_ID = "gitlab-client-id";
  process.env.GITLAB_OAUTH_CLIENT_SECRET = "gitlab-client-secret";
  /* oxlint-enable node/no-process-env */
});

interface GitlabUser {
  id: number;
  email: string;
  confirmed: boolean;
}

const gitlabUsers = new Map<number, GitlabUser>();

const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** GitLab's token endpoint and `/api/v4/user`: a code `code-<id>` is
 *  traded for a token `token-<id>`, which reads that user's profile. */
async function gitlab(url: URL, request: Request): Promise<Response> {
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    const id = Number(form.get("code")?.replace(/^code-/, ""));
    if (form.get("grant_type") !== "authorization_code" || !gitlabUsers.has(id))
      return json(400, { error: "invalid_grant" });
    return json(200, {
      access_token: `token-${id}`,
      token_type: "Bearer",
      expires_in: 7200,
      refresh_token: `refresh-${id}`,
      scope: "read_user",
    });
  }
  if (url.pathname === "/api/v4/user") {
    const id = Number(request.headers.get("authorization")?.replace(/^Bearer token-/, ""));
    const found = gitlabUsers.get(id);
    if (!found) return json(401, { message: "401 Unauthorized" });
    return json(200, {
      id: found.id,
      username: `user${found.id}`,
      name: `User ${found.id}`,
      email: found.email,
      state: "active",
      avatar_url: "",
      web_url: `${url.origin}/user${found.id}`,
      confirmed_at: found.confirmed ? "2026-01-01T00:00:00.000Z" : null,
    });
  }
  return json(404, { message: "404 Not Found" });
}

const fakeFetch: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.hostname === "gitlab.com" || url.hostname === new URL(SELF_MANAGED).hostname)
      return gitlab(url, request);
    return realFetch(input, init);
  },
  { preconnect: realFetch.preconnect },
);

const seed = {
  unconfirmed: { id: 701, email: `unconfirmed-${uniq()}@example.com`, confirmed: false },
  confirmed: { id: 702, email: `owner-${uniq()}@example.com`, confirmed: true },
  selfManaged: { id: 703, email: `selfmanaged-${uniq()}@example.com`, confirmed: true },
};
for (const entry of Object.values(seed)) gitlabUsers.set(entry.id, entry);

async function seedOtterUser(email: string): Promise<string> {
  const [row] = await db
    .insert(user)
    .values({ name: email, email, emailVerified: true })
    .returning({ id: user.id });
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function gitlabAccounts(userId: string) {
  return db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "gitlab")));
}

/** Cookies from a Set-Cookie list, as a Cookie header. */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * Sign in with GitLab as the GitLab user `gitlabUserId`. Returns where the
 * callback sent the browser: the app on success, an `error=` URL otherwise.
 */
let signIns = 0;
async function signInWithGitlab(gitlabUserId: number): Promise<string> {
  // A distinct client address per sign-in: better-auth allows 3 sign-in
  // attempts per 10 s per address, and these are separate browsers.
  signIns++;
  const started = await auth.handler(
    new Request(`${APP_ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP_ORIGIN,
        "x-forwarded-for": `198.51.100.${signIns}`,
      },
      body: JSON.stringify({ provider: "gitlab", callbackURL: "/projects" }),
    }),
  );
  const body: unknown = await started.json();
  const parsed = z.object({ url: z.string() }).safeParse(body);
  if (!parsed.success) throw new Error(`sign-in/social ${started.status}: ${JSON.stringify(body)}`);
  const authorize = new URL(parsed.data.url);
  expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);
  // What GitLab's consent page redirects back with.
  const callback = new URL(CALLBACK);
  callback.searchParams.set("code", `code-${gitlabUserId}`);
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  const landed = await auth.handler(
    new Request(callback.toString(), { headers: { cookie: cookieHeader(started) } }),
  );
  return landed.headers.get("location") ?? `status ${landed.status}`;
}

describe("GitLab sign-in and account linking", () => {
  let previousIssuer: string | null = null;

  beforeAll(async () => {
    vi.stubGlobal("fetch", fakeFetch);
    const [row] = await db
      .select({ issuer: platformSettings.gitlabOauthIssuer })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
    previousIssuer = row?.issuer ?? null;
    await reloadAuth();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db
      .update(platformSettings)
      .set({ gitlabOauthIssuer: previousIssuer })
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
    await reloadAuth();
  });

  it("gitlab.com with an UNCONFIRMED email cannot claim the account with that email", async () => {
    const existingId = await seedOtterUser(seed.unconfirmed.email);
    const landed = await signInWithGitlab(seed.unconfirmed.id);
    expect(landed).toContain("error=account_not_linked");
    expect(await gitlabAccounts(existingId)).toHaveLength(0);
  });

  it("gitlab.com with a confirmed email links, and signs in again by account", async () => {
    const ownerId = await seedOtterUser(seed.confirmed.email);
    const first = await signInWithGitlab(seed.confirmed.id);
    expect(first).not.toContain("error=");
    expect(await gitlabAccounts(ownerId)).toHaveLength(1);
    const again = await signInWithGitlab(seed.confirmed.id);
    expect(again).not.toContain("error=");
  });

  it("a self-managed GitLab cannot claim an account by email, confirmed or not", async () => {
    await db
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, gitlabOauthIssuer: SELF_MANAGED })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { gitlabOauthIssuer: SELF_MANAGED },
      });
    await reloadAuth();
    const existingId = await seedOtterUser(seed.selfManaged.email);
    const landed = await signInWithGitlab(seed.selfManaged.id);
    expect(landed).toContain("error=account_not_linked");
    expect(await gitlabAccounts(existingId)).toHaveLength(0);
  });
});
