/**
 * A public-repo deploy must not depend on GitHub's anonymous REST budget.
 * The budget is 60 requests an hour per IP; after a handful of
 * deploys every later one failed "GitHub commit lookup failed (403)". The head
 * now comes from git, and the API is only asked for the commit's message and
 * author, so an exhausted or blocked API costs a deployment its provenance and
 * nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./github-app-config", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...real, loadGithubAppForInstallation: vi.fn() };
});
vi.mock("./github-app-core", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...real, getInstallationToken: async () => ({ token: "ghs_install" }) };
});
vi.mock("@otterdeploy/shared/egress-policy", () => ({
  egressFetch: vi.fn(),
  EgressPolicyError: class EgressPolicyError extends Error {},
}));
vi.mock("../lib/egress-denylist", () => ({
  controlPlaneEgressDenylist: vi.fn().mockResolvedValue({ blockedHosts: [], blockedAddresses: [] }),
}));
vi.mock("../lib/egress-options", () => ({
  egressAllowlist: () => [],
}));
// git itself is the other half of the fake: ls-remote answers, or does not.
vi.mock("./git-ls-remote", () => ({ lsRemoteSha: vi.fn() }));
const token: { value: string | null } = { value: null };
vi.mock("./github-api-budget", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...real, configuredGithubToken: () => token.value };
});

import type { EgressResponse } from "@otterdeploy/shared/egress-policy";

import { EgressPolicyError, egressFetch } from "@otterdeploy/shared/egress-policy";

import { lsRemoteSha } from "./git-ls-remote";
import { resetApiBudget } from "./github-api-budget";
import { fetchBranchHead, resetCommitMetaCache } from "./github-app-repos";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): EgressResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://api.github.com/",
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const commit = (sha: string) => ({
  sha,
  commit: { message: "ship it", author: { name: "Ada" } },
  author: { avatar_url: "https://avatars.example/ada", login: "ada" },
});

/** What api.github.com says to an anonymous caller whose hour is spent. */
const exhausted = () =>
  response(
    403,
    { message: "API rate limit exceeded for 203.0.113.9." },
    { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" },
  );

const api = vi.mocked(egressFetch);
const git = vi.mocked(lsRemoteSha);

beforeEach(() => {
  api.mockReset();
  git.mockReset();
  resetApiBudget();
  resetCommitMetaCache();
  token.value = null;
});

describe("fetchBranchHead for a public repo (no installation)", () => {
  it("deploys with the commit from git when the anonymous API is exhausted", async () => {
    git.mockResolvedValue(SHA_A);
    api.mockResolvedValue(exhausted());

    const head = await fetchBranchHead(null, "miniflux", "v2", "main");

    expect(head).toEqual({ sha: SHA_A, message: null, authorName: null, authorAvatar: null });
    expect(git).toHaveBeenCalledWith("https://github.com/miniflux/v2.git", "main");
  });

  it("stops asking an exhausted API at all until its budget resets", async () => {
    git.mockResolvedValueOnce(SHA_A).mockResolvedValueOnce(SHA_B).mockResolvedValueOnce(SHA_C);
    api.mockResolvedValue(exhausted());

    await fetchBranchHead(null, "acme", "one", "main");
    expect(api).toHaveBeenCalledTimes(1);
    const second = await fetchBranchHead(null, "acme", "two", "main");
    const third = await fetchBranchHead(null, "acme", "three", "main");

    // The first 403 taught us the hour is spent: later deploys do not retry it.
    expect(api).toHaveBeenCalledTimes(1);
    expect([second.sha, third.sha]).toEqual([SHA_B, SHA_C]);
  });

  it("deploys when the API is unreachable (blocked egress), and backs off it", async () => {
    git.mockResolvedValue(SHA_A);
    api.mockRejectedValue(new EgressPolicyError("blocked"));

    const first = await fetchBranchHead(null, "acme", "one", "main");
    git.mockResolvedValue(SHA_B);
    const second = await fetchBranchHead(null, "acme", "two", "main");

    expect(first.sha).toBe(SHA_A);
    expect(second.sha).toBe(SHA_B);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("deploys when the API fails outright (5xx)", async () => {
    git.mockResolvedValue(SHA_A);
    api.mockResolvedValue(response(500, { message: "boom" }));

    expect((await fetchBranchHead(null, "acme", "web", "main")).sha).toBe(SHA_A);
  });

  it("keeps the commit message and author while the API is healthy, and asks once per commit", async () => {
    git.mockResolvedValue(SHA_A);
    api.mockResolvedValue(response(200, commit(SHA_A), { "x-ratelimit-remaining": "58" }));

    const first = await fetchBranchHead(null, "acme", "web", "main");
    const again = await fetchBranchHead(null, "acme", "web", "main");

    expect(first).toEqual({
      sha: SHA_A,
      message: "ship it",
      authorName: "Ada",
      authorAvatar: "https://avatars.example/ada",
    });
    expect(again).toEqual(first);
    // A redeploy of the same head spends no request: a commit never changes.
    expect(api).toHaveBeenCalledTimes(1);
    // And the lookup is by the commit git named, not by the moving branch.
    expect(api.mock.calls[0]?.[0]).toBe(`https://api.github.com/repos/acme/web/commits/${SHA_A}`);
  });

  it("learns the budget is spent from the response that used the last request", async () => {
    git.mockResolvedValueOnce(SHA_A).mockResolvedValueOnce(SHA_B);
    api.mockResolvedValue(
      response(200, commit(SHA_A), {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "9999999999",
      }),
    );

    const first = await fetchBranchHead(null, "acme", "one", "main");
    const second = await fetchBranchHead(null, "acme", "two", "main");

    expect(first.message).toBe("ship it");
    expect(second).toEqual({ sha: SHA_B, message: null, authorName: null, authorAvatar: null });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("sends the configured token on the API call it still makes", async () => {
    token.value = "ghp_configured";
    git.mockResolvedValue(SHA_A);
    api.mockResolvedValue(response(200, commit(SHA_A)));

    await fetchBranchHead(null, "acme", "web", "main");

    expect(api.mock.calls[0]?.[1]?.headers?.Authorization).toBe("Bearer ghp_configured");
  });

  it("sends no credentials when none is configured", async () => {
    git.mockResolvedValue(SHA_A);
    api.mockResolvedValue(response(200, commit(SHA_A)));

    await fetchBranchHead(null, "acme", "web", "main");

    expect(api.mock.calls[0]?.[1]?.headers?.Authorization).toBeUndefined();
  });

  it("falls back to the API when git cannot see the repo, and surfaces its failure", async () => {
    git.mockResolvedValue(null);
    api.mockResolvedValue(response(404, { message: "Not Found" }));

    await expect(fetchBranchHead(null, "acme", "private-thing", "main")).rejects.toThrow(
      /GitHub commit lookup failed for acme\/private-thing@main \(404\)/,
    );
  });

  it("still resolves through the API when git has no route to the repo", async () => {
    git.mockResolvedValue(null);
    api.mockResolvedValue(response(200, commit(SHA_B)));

    const head = await fetchBranchHead(null, "acme", "web", "main");

    expect(head.sha).toBe(SHA_B);
    expect(api.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/acme/web/commits/main");
  });

  it("reports the original error when git cannot see the repo and the API is exhausted", async () => {
    git.mockResolvedValue(null);
    api.mockResolvedValue(exhausted());

    await expect(fetchBranchHead(null, "acme", "web", "main")).rejects.toThrow(
      /GitHub commit lookup failed for acme\/web@main \(403\)/,
    );
  });
});

describe("fetchBranchHead when GitHub answers without a commit", () => {
  it("refuses to deploy an answer that names no SHA", async () => {
    git.mockResolvedValue(null);
    api.mockResolvedValue(response(200, {}));

    await expect(fetchBranchHead(null, "acme", "web", "main")).rejects.toThrow(
      /GitHub returned no SHA for acme\/web@main/,
    );
  });
});

describe("fetchBranchHead for a pinned commit", () => {
  it("vouches for the commit through the API, so a mistyped pin is refused", async () => {
    api.mockResolvedValue(response(404, { message: "Not Found" }));

    await expect(fetchBranchHead(null, "acme", "web", SHA_A)).rejects.toThrow(/\(404\)/);
    expect(git).not.toHaveBeenCalled();
  });

  it("still deploys the pin when the API is exhausted", async () => {
    api.mockResolvedValue(exhausted());

    const head = await fetchBranchHead(null, "acme", "web", SHA_A);
    const later = await fetchBranchHead(null, "acme", "web", SHA_B);

    expect(head).toEqual({ sha: SHA_A, message: null, authorName: null, authorAvatar: null });
    expect(later.sha).toBe(SHA_B);
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("fetchBranchHead for a repo with an installation", () => {
  it("is untouched: no git, the API answers with the installation token", async () => {
    api.mockResolvedValue(response(200, commit(SHA_A)));

    const head = await fetchBranchHead("42", "acme", "private-thing", "main");

    expect(head.sha).toBe(SHA_A);
    expect(git).not.toHaveBeenCalled();
    expect(api.mock.calls[0]?.[1]?.headers?.Authorization).toBe("Bearer ghs_install");
  });
});
