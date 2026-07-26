import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// inspect-github.ts's fetch helpers (fetchFullTree via getTreeSnapshot,
// fetchPackageJson, fetchTextFile) now go through `ghFetch`
// (packages/api/src/git/github-app.ts) instead of calling `fetch` directly —
// od-skk closed the SSRF gap left by od-5j8.7 (these two files were excluded
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
  controlPlaneEgressDenylist: vi
    .fn()
    .mockResolvedValue({ blockedHosts: [], blockedAddresses: [] }),
}));
vi.mock("../../lib/egress-options", () => ({
  egressAllowlist: () => [],
}));

import { EgressPolicyError, egressFetch } from "@otterdeploy/shared/egress-policy";

import { fetchPackageJson, fetchTextFile, getTreeSnapshot, type RepoBinding } from "./inspect-github";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
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
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = egressFetch as unknown as FetchMock;
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
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/git/trees/main?recursive=1");
  });

  it("fetchPackageJson calls egressFetch for a legitimate host and parses the result", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(JSON.stringify({ dependencies: { react: "^18" } })));

    const result = await fetchPackageJson(binding, "package.json", "repo-pkg-1");

    expect(result).toEqual({ dependencies: { react: "^18" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
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
