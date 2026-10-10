import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// inspect-github.ts's fetch helpers (fetchFullTree via getTreeSnapshot,
// fetchPackageJson, fetchTextFile) now go through `ghFetch`
// (packages/api/src/git/github-app.ts) instead of calling `fetch` directly.
// Od-skk closed the SSRF gap left by od-5j8.7 (these two files were excluded
// from that pass while a sibling agent owned routers/git/**). ghFetch routes
// every request through the shared egress policy, so stub the same seam
// github-app-repos.test.ts / github-app-writeback.test.ts use to keep this a
// pure unit test. The real fail-closed behavior of the policy itself
// (loopback / 169.254.169.254 / RFC1918 / DNS-rebinding) is proven against
// the unmocked chain in git/github-app-egress.test.ts; this file proves
// these specific call sites are actually wired through it.
vi.mock("@otterdeploy/shared/egress-policy", () => ({
  egressFetch: vi.fn(),
  EgressPolicyError: class EgressPolicyError extends Error {},
}));
vi.mock("../../lib/egress-denylist", () => ({
  controlPlaneEgressDenylist: vi.fn().mockResolvedValue({ blockedHosts: [], blockedAddresses: [] }),
}));
vi.mock("../../lib/egress-options", () => ({
  egressAllowlist: () => [],
}));

// Public-repo reads try git first (../../git/git-snapshot.ts). Unless a test
// says otherwise git "cannot reach the repo", so the cases below keep proving
// the API fallback goes through the egress policy.
vi.mock("../../git/git-snapshot", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    gitTreeEntries: vi.fn().mockResolvedValue(null),
    gitReadFile: vi.fn().mockResolvedValue({ status: "unavailable" }),
  };
});

import {
  EgressPolicyError,
  egressFetch,
  type EgressResponse,
} from "@otterdeploy/shared/egress-policy";

import { gitReadFile, gitTreeEntries } from "../../git/git-snapshot";
import {
  fetchPackageJson,
  fetchTextFile,
  getTreeSnapshot,
  type RepoBinding,
} from "./inspect-github";

function jsonResponse(body: unknown, ok = true, status = 200): EgressResponse {
  return {
    ok,
    status,
    url: "https://api.github.com/",
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function textResponse(body: string, ok = true, status = 200): EgressResponse {
  return {
    ok,
    status,
    url: "https://api.github.com/",
    headers: { get: () => null },
    text: async () => body,
    json: async (): Promise<unknown> => JSON.parse(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

// installationGithubId: null → ghHeaders skips getInstallationToken, so
// these tests never touch the DB or JWT signing.
const binding: RepoBinding = {
  owner: "acme",
  repo: "widgets",
  installationGithubId: null,
  defaultBranch: "main",
};

describe("inspect-github fetch helpers → routed through the shared egress policy", () => {
  // The module factory above replaced `egressFetch` with a `vi.fn()`;
  // `vi.mocked` recovers that mock's typed surface without an assertion.
  const fetchMock = vi.mocked(egressFetch);

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("getTreeSnapshot (full tree fetch) calls egressFetch, not raw fetch, for a legitimate host", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        tree: [
          { path: "src", type: "tree", sha: "a" },
          { path: "src/index.ts", type: "blob", sha: "b" },
        ],
      }),
    );

    const snap = await getTreeSnapshot(binding, "repo-tree-1");

    expect(snap.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/git/trees/main?recursive=1");
  });

  it("fetchPackageJson calls egressFetch for a legitimate host and parses the result", async () => {
    fetchMock.mockResolvedValueOnce(
      textResponse(JSON.stringify({ dependencies: { react: "^18" } })),
    );

    const result = await fetchPackageJson(binding, "package.json", "repo-pkg-1");

    expect(result).toEqual({ dependencies: { react: "^18" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/contents/package.json?ref=main");
  });

  it("fetchTextFile calls egressFetch for a legitimate host", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("EXAMPLE_KEY=\n"));

    const result = await fetchTextFile(binding, ".env.example");

    expect(result).toBe("EXAMPLE_KEY=\n");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetchPackageJson fails closed with the policy's clear error instead of silently succeeding", async () => {
    fetchMock.mockRejectedValueOnce(
      new EgressPolicyError("The hostname resolves to a non-public address."),
    );

    await expect(fetchPackageJson(binding, "package.json", "repo-pkg-2")).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/,
    );
  });

  it("getTreeSnapshot propagates a blocked-egress failure with the policy's clear error", async () => {
    fetchMock.mockRejectedValueOnce(new EgressPolicyError("Only HTTPS URLs are allowed."));

    await expect(getTreeSnapshot(binding, "repo-tree-2")).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/,
    );
  });
});

describe("inspect-github on a public repo: git first, the API only as a fallback", () => {
  const fetchMock = vi.mocked(egressFetch);
  const treeViaGit = vi.mocked(gitTreeEntries);
  const fileViaGit = vi.mocked(gitReadFile);

  beforeEach(() => {
    fetchMock.mockReset();
    treeViaGit.mockReset().mockResolvedValue(null);
    fileViaGit.mockReset().mockResolvedValue({ status: "unavailable" });
  });

  it("reads the tree with git and spends no GitHub API request", async () => {
    treeViaGit.mockResolvedValueOnce([
      { path: "src", type: "dir" },
      { path: "src/index.ts", type: "file" },
    ]);

    const snap = await getTreeSnapshot(binding, "repo-git-tree-1");

    expect(snap.isOk()).toBe(true);
    if (snap.isErr()) return;
    expect(snap.value.paths).toEqual(["src", "src/index.ts"]);
    expect(snap.value.pathTypes.get("src")).toBe("dir");
    expect(snap.value.pathTypes.get("src/index.ts")).toBe("file");
    expect(treeViaGit).toHaveBeenCalledWith("https://github.com/acme/widgets.git", "main");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still inspects a repo while the anonymous API budget is spent", async () => {
    treeViaGit.mockResolvedValueOnce([{ path: "package.json", type: "file" }]);
    fileViaGit.mockResolvedValueOnce({
      status: "ok",
      text: JSON.stringify({ dependencies: { next: "^15" } }),
    });
    // Every API request would be refused: the budget is gone.
    fetchMock.mockResolvedValue(jsonResponse({ message: "API rate limit exceeded" }, false, 403));

    const snap = await getTreeSnapshot(binding, "repo-git-tree-2");
    const pkg = await fetchPackageJson(binding, "package.json", "repo-git-pkg-2");

    expect(snap.isOk()).toBe(true);
    expect(pkg).toEqual({ dependencies: { next: "^15" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a file git says is not in the repo is absent without asking the API", async () => {
    fileViaGit.mockResolvedValue({ status: "missing" });

    expect(await fetchPackageJson(binding, "apps/api/package.json", "repo-git-pkg-3")).toBeNull();
    expect(await fetchTextFile(binding, ".env.example")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a text file with git", async () => {
    fileViaGit.mockResolvedValueOnce({ status: "ok", text: "KEY=\n" });

    expect(await fetchTextFile(binding, ".env.example")).toBe("KEY=\n");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the API when git cannot reach the repo", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("KEY=\n"));

    expect(await fetchTextFile(binding, ".env.example")).toBe("KEY=\n");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never reads an installation-backed repo with anonymous git", async () => {
    // The API token path is how private repos are read; git has no credentials.
    const installed: RepoBinding = { ...binding, installationGithubId: "42" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ tree: [] }));
    // The token mint is a DB + JWT affair; this only needs to prove git is skipped.
    await getTreeSnapshot(installed, "repo-git-tree-3").catch(() => undefined);

    expect(treeViaGit).not.toHaveBeenCalled();
  });
});
