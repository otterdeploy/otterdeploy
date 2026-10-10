/**
 * A GitHub App install/manifest callback re-checks membership.
 *
 * The callbacks carry a signed state minted by an org-scoped call for a member,
 * valid for 15 minutes. A user removed from the organization in that window
 * must not finish wiring a GitHub App into it. The state signing is real; the
 * member table and the GitHub-side completion are doubles.
 */
import { signInstallState, verifyInstallState } from "@otterdeploy/api/git/state";
import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const isOrgMember = vi.fn(async (_userId: string, _orgId: string) => true);
const completeGithubConnect = vi.fn(async () => ({ accountLogin: "acme", repoCount: 1 }));
const completeManifestExchange = vi.fn(async () => ({
  providerId: "gitp_1",
  appSlug: "acme-otter",
  installRedirectUrl: "https://github.com/apps/acme-otter/installations/new",
}));

vi.mock("@otterdeploy/api/authz/org-member", () => ({ isOrgMember }));
vi.mock("@otterdeploy/auth/web-origin", () => ({
  resolveCanonicalWebOrigin: async (fallback: string) => fallback,
}));
vi.mock("@otterdeploy/api/git", () => ({
  completeGithubConnect,
  completeManifestExchange,
  GithubAppNotConfiguredError: class GithubAppNotConfiguredError extends Error {},
  signInstallState,
  verifyInstallState,
}));

const { githubInstallCallbackHandler, githubManifestCallbackHandler } = await import("../install");

const app = new Hono()
  .get("/install", githubInstallCallbackHandler)
  .get("/manifest", githubManifestCallbackHandler);

async function state() {
  return signInstallState({ orgId: "org_acme", userId: "user_removed" });
}

beforeEach(() => {
  isOrgMember.mockReset();
  completeGithubConnect.mockClear();
  completeManifestExchange.mockClear();
});

describe("GitHub callbacks", () => {
  test("install: a member still in the organization connects", async () => {
    isOrgMember.mockResolvedValue(true);
    const res = await app.request(
      `/install?installation_id=1&setup_action=install&state=${encodeURIComponent(await state())}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("git_install=ok");
    expect(completeGithubConnect).toHaveBeenCalled();
  });

  test("install: a user removed since the state was signed is refused", async () => {
    isOrgMember.mockResolvedValue(false);
    const res = await app.request(
      `/install?installation_id=1&setup_action=install&state=${encodeURIComponent(await state())}`,
    );
    expect(res.headers.get("location")).toContain("git_install=error");
    expect(completeGithubConnect).not.toHaveBeenCalled();
    expect(isOrgMember).toHaveBeenCalledWith("user_removed", "org_acme");
  });

  test("manifest: a user removed since the state was signed is refused", async () => {
    isOrgMember.mockResolvedValue(false);
    const res = await app.request(`/manifest?code=abc&state=${encodeURIComponent(await state())}`);
    expect(res.headers.get("location")).toContain("git_install=error");
    expect(completeManifestExchange).not.toHaveBeenCalled();
  });
});
