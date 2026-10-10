import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// listInstallationRepos is pure fetch, no DB, no JWT mint. The config-loader
// module is mocked anyway so the import chain never touches @otterdeploy/db.
vi.mock("./github-app-config", () => ({
  loadGithubAppForInstallation: vi.fn(),
  apiBaseUrlForHost: () => "https://api.github.com",
}));
// github-app.ts's `ghFetch` wrapper routes every request through the shared
// egress policy (SSRF hardening): stub both the network call and the
// control-plane-identity denylist lookup (a DB read) so this stays a pure
// unit test.
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
// The anonymous head lookup's git fallback: no network in a unit test.
vi.mock("./git-ls-remote", () => ({ lsRemoteSha: vi.fn() }));

import type { EgressResponse } from "@otterdeploy/shared/egress-policy";

import { egressFetch } from "@otterdeploy/shared/egress-policy";

import type { GithubAppConfig, InstallationRepo } from "./github-app";

import { lsRemoteSha } from "./git-ls-remote";
import { fetchBranchHead, listInstallationRepos } from "./github-app";

const config: GithubAppConfig = {
  appId: "12345",
  privateKeyPem: "unused",
  apiBaseUrl: "https://api.github.com",
};

function repo(n: number): InstallationRepo {
  return {
    id: n,
    node_id: `R_node_${n}`,
    full_name: `acme/repo-${n}`,
    name: `repo-${n}`,
    private: true,
    default_branch: "main",
    clone_url: `https://github.com/acme/repo-${n}.git`,
  };
}

const repos = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => repo(from + i));

function jsonResponse(body: unknown, ok = true, status = 200): EgressResponse {
  return {
    ok,
    status,
    url: "https://api.github.com/installation/repositories",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("listInstallationRepos → repo list + truthful count", () => {
  const fetchMock = vi.mocked(egressFetch);

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns all repos and GitHub's total_count from a single page", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total_count: 77, repositories: repos(1, 77) }));

    const result = await listInstallationRepos("ghs_test", config);

    expect(result.repositories).toHaveLength(77);
    expect(result.totalCount).toBe(77);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/installation/repositories?per_page=100&page=1");
    expect(init?.headers?.Authorization).toBe("Bearer ghs_test");
  });

  it("walks pagination past 100 repos and keeps total_count", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ total_count: 137, repositories: repos(1, 100) }))
      .mockResolvedValueOnce(jsonResponse({ total_count: 137, repositories: repos(101, 37) }));

    const result = await listInstallationRepos("ghs_test", config);

    expect(result.repositories).toHaveLength(137);
    expect(result.totalCount).toBe(137);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1] ?? [];
    expect(secondUrl).toContain("page=2");
    // No duplicates across pages.
    const ids = new Set(result.repositories.map((r) => r.id));
    expect(ids.size).toBe(137);
  });

  it("reports total_count even when the repository list lags behind it", async () => {
    // GitHub can briefly return a short/empty page right after an install
    // while still knowing the true total: the count must come from
    // total_count, never repositories.length, so the UI shows 77, not 0.
    fetchMock.mockResolvedValueOnce(jsonResponse({ total_count: 77, repositories: [] }));

    const result = await listInstallationRepos("ghs_test", config);

    expect(result.repositories).toHaveLength(0);
    expect(result.totalCount).toBe(77);
  });

  it("returns a genuine zero when the installation grants no repos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total_count: 0, repositories: [] }));

    const result = await listInstallationRepos("ghs_test", config);

    expect(result.repositories).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("throws on a non-2xx response instead of returning an empty (wrong) list", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, false, 403));

    await expect(listInstallationRepos("ghs_test", config)).rejects.toThrow(
      /GitHub repos list failed \(403\)/,
    );
  });
});

describe("fetchBranchHead on an anonymous (public) repo", () => {
  const fetchMock = vi.mocked(egressFetch);
  const lsRemote = vi.mocked(lsRemoteSha);
  const SHA = "1".repeat(40);

  beforeEach(() => {
    fetchMock.mockReset();
    lsRemote.mockReset();
  });

  it("falls back to git ls-remote when GitHub rate-limits the anonymous lookup", async () => {
    // GitHub allows 60 anonymous calls an hour per IP; a few deploys spend
    // them, and every next public-repo deploy failed at the head lookup.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "API rate limit exceeded for 203.0.113.7." }, false, 403),
    );
    lsRemote.mockResolvedValueOnce(SHA);

    const head = await fetchBranchHead(null, "miniflux", "v2", "2.3.3");

    expect(head).toEqual({ sha: SHA, message: null, authorName: null, authorAvatar: null });
    expect(lsRemote).toHaveBeenCalledWith("https://github.com/miniflux/v2.git", "2.3.3");
  });

  it("still fails, with GitHub's status, when git cannot resolve the ref either", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, false, 429));
    lsRemote.mockResolvedValueOnce(null);

    await expect(fetchBranchHead(null, "acme", "private", "main")).rejects.toThrow(
      /GitHub commit lookup failed for acme\/private@main \(429\)/,
    );
  });

  it("an unknown or private repo: git finds nothing, and the API's 404 is the deploy's failure", async () => {
    // Git is asked first; it cannot see the repo, so the API is the only road
    // left and its answer is the error.
    lsRemote.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, false, 404));

    await expect(fetchBranchHead(null, "acme", "gone", "main")).rejects.toThrow(/\(404\)/);
    expect(lsRemote).toHaveBeenCalledWith("https://github.com/acme/gone.git", "main");
  });
});
