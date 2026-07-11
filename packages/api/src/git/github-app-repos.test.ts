import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// listInstallationRepos is pure fetch — no DB, no JWT mint. The config-loader
// module is mocked anyway so the import chain never touches @otterdeploy/db.
vi.mock("./github-app-config", () => ({
  loadGithubAppForInstallation: vi.fn(),
}));

import type { GithubAppConfig, InstallationRepo } from "./github-app";

import { listInstallationRepos } from "./github-app";

type FetchMock = ReturnType<typeof vi.fn>;

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

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("listInstallationRepos → repo list + truthful count", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns all repos and GitHub's total_count from a single page", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total_count: 77, repositories: repos(1, 77) }));

    const result = await listInstallationRepos("ghs_test", config);

    expect(result.repositories).toHaveLength(77);
    expect(result.totalCount).toBe(77);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.github.com/installation/repositories?per_page=100&page=1");
    expect(init.headers.Authorization).toBe("Bearer ghs_test");
  });

  it("walks pagination past 100 repos and keeps total_count", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ total_count: 137, repositories: repos(1, 100) }))
      .mockResolvedValueOnce(jsonResponse({ total_count: 137, repositories: repos(101, 37) }));

    const result = await listInstallationRepos("ghs_test", config);

    expect(result.repositories).toHaveLength(137);
    expect(result.totalCount).toBe(137);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1] as [string];
    expect(secondUrl).toContain("page=2");
    // No duplicates across pages.
    const ids = new Set(result.repositories.map((r) => r.id));
    expect(ids.size).toBe(137);
  });

  it("reports total_count even when the repository list lags behind it", async () => {
    // GitHub can briefly return a short/empty page right after an install
    // while still knowing the true total — the count must come from
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
