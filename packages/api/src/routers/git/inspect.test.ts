/**
 * od-skk: proves `listRepoBranches` (inspect.ts) now routes its GitHub call
 * through `ghFetch` (the shared SSRF-hardened egress policy wrapper), the
 * same way inspect-github.test.ts proves it for the tree/package.json/env
 * file fetches. Before this fix, this was the last raw `fetch(url, {
 * headers })` call in routers/git/**, reachable from a caller-supplied
 * `gitRepoId`.
 */
// oxlint-disable-next-line node/no-process-env -- test env setup boundary: satisfy required vars so the module graph (which imports @otterdeploy/db / @otterdeploy/env) loads.
process.env.DATABASE_URL ??= "postgres://test/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.RESEND_API_KEY ??= "test-resend-key";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// A public-URL-bound repo (installationId null) so resolveRepoBinding's
// db.select() resolves without a second (installation) lookup.
interface FixtureRow {
  installationId: string | null;
  fullName: string;
  defaultBranch: string;
  providerRepoId: string | null;
}
let currentRow: FixtureRow | undefined = {
  installationId: null,
  fullName: "acme/widgets",
  defaultBranch: "main",
  providerRepoId: null,
};

/** The subset of drizzle's select builder the code under test touches. */
interface SelectChain {
  from: () => SelectChain;
  where: () => SelectChain;
  limit: () => Promise<FixtureRow[]>;
}
const chain: SelectChain = {
  from: () => chain,
  where: () => chain,
  limit: () => Promise.resolve(currentRow ? [currentRow] : []),
};

vi.mock("@otterdeploy/db", () => ({
  db: { select: () => chain },
}));

// ghFetch (github-app.ts) routes every request through the shared egress
// policy: stub the same seam github-app-repos.test.ts /
// github-app-writeback.test.ts / inspect-github.test.ts use. The fn is
// created inside `vi.hoisted` so the test can hold the untyped mock handle
// directly instead of casting the typed `egressFetch` import back to a mock.
const { egressFetchMock } = vi.hoisted(() => ({ egressFetchMock: vi.fn() }));
vi.mock("@otterdeploy/shared/egress-policy", () => ({
  egressFetch: egressFetchMock,
  EgressPolicyError: class EgressPolicyError extends Error {},
}));
vi.mock("../../lib/egress-denylist", () => ({
  controlPlaneEgressDenylist: vi.fn().mockResolvedValue({ blockedHosts: [], blockedAddresses: [] }),
}));
vi.mock("../../lib/egress-options", () => ({
  egressAllowlist: () => [],
}));

import { EgressPolicyError } from "@otterdeploy/shared/egress-policy";

import { listRepoBranches } from "./inspect";

/** The minimal Response surface the code under test touches. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("listRepoBranches → routed through the shared egress policy", () => {
  const fetchMock = egressFetchMock;

  beforeEach(() => {
    fetchMock.mockReset();
    currentRow = {
      installationId: null,
      fullName: "acme/widgets",
      defaultBranch: "main",
      providerRepoId: null,
    };
  });

  it("calls egressFetch (not raw fetch) for a legitimate host and returns the branch list", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ name: "main" }, { name: "feat/x" }]));

    const result = await listRepoBranches("gitr_repo1");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.branches).toEqual(["main", "feat/x"]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall: unknown[] = fetchMock.mock.calls[0] ?? [];
    expect(firstCall[0]).toBe(
      "https://api.github.com/repos/acme/widgets/branches?per_page=100&page=1",
    );
  });

  it("fails closed with the policy's clear error when the target is blocked by the egress policy", async () => {
    fetchMock.mockRejectedValueOnce(
      new EgressPolicyError("The hostname resolves to a non-public address."),
    );

    await expect(listRepoBranches("gitr_repo2")).rejects.toThrow(
      /GitHub API request blocked by outbound egress policy/,
    );
  });
});
