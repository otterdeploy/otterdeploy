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

import { Temporal } from "@otterdeploy/shared/temporal";
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

// Public-repo reads try git first (../../git/git-snapshot.ts); these cases are
// about the API fallback, so git "cannot reach the repo" (and the suite never
// touches the network).
vi.mock("../../git/git-snapshot", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    gitTreeEntries: vi.fn().mockResolvedValue(null),
    gitReadFile: vi.fn().mockResolvedValue({ status: "unavailable" }),
  };
});

import { EgressPolicyError } from "@otterdeploy/shared/egress-policy";

import { inspectRepoTree, listRepoBranches } from "./inspect";

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

/** A raw-text Contents API response (the shape `Accept: raw` returns). */
function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, text: async () => body };
}

/** Route the stubbed egress fetch by URL: the tree, then any file contents. */
function serveRepo(files: Record<string, string>) {
  egressFetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/git/trees/")) {
      const tree = Object.keys(files).map((path) => ({ path, type: "blob", sha: path }));
      return jsonResponse({ tree });
    }
    const match = /\/contents\/([^?]+)/.exec(url);
    const body = match?.[1] ? files[match[1]] : undefined;
    return body === undefined ? textResponse("Not Found", false, 404) : textResponse(body);
  });
}

describe("inspectRepoTree → Dockerfile detection", () => {
  beforeEach(() => {
    egressFetchMock.mockReset();
    currentRow = {
      installationId: null,
      fullName: "corentinth/it-tools",
      defaultBranch: "main",
      providerRepoId: null,
    };
  });

  it("reports the root Dockerfile and the port its final stage EXPOSEs", async () => {
    serveRepo({
      "package.json": JSON.stringify({ devDependencies: { vite: "^5" } }),
      Dockerfile:
        "FROM node:lts-alpine AS build\nRUN pnpm build\nFROM nginx:stable-alpine\nEXPOSE 80\n",
    });

    const result = await inspectRepoTree({ gitRepoId: "gitr_ittools", path: "" });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.framework).toBe("vite");
    expect(result.value.dockerfile).toEqual({ path: "Dockerfile", exposedPorts: [80] });
  });

  it("reports no Dockerfile for a repo without one, so the build stays on railpack", async () => {
    serveRepo({ "package.json": JSON.stringify({ dependencies: { next: "15" } }) });

    const result = await inspectRepoTree({ gitRepoId: "gitr_nodocker", path: "" });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.dockerfile).toBeNull();
  });

  it("reads the Dockerfile once per TTL across folder navigations, then again after it", async () => {
    serveRepo({ Dockerfile: "FROM nginx\nEXPOSE 80\n" });
    const dockerfileReads = () =>
      egressFetchMock.mock.calls.filter((call: unknown[]) =>
        String(call[0]).includes("/contents/Dockerfile"),
      ).length;

    await inspectRepoTree({ gitRepoId: "gitr_ttl", path: "" });
    await inspectRepoTree({ gitRepoId: "gitr_ttl", path: "" });
    expect(dockerfileReads()).toBe(1);

    // The cache clock is Temporal's, which fake timers do not move.
    const later = Temporal.Now.instant().add({ minutes: 5, milliseconds: 1 });
    const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(later);
    try {
      await inspectRepoTree({ gitRepoId: "gitr_ttl", path: "" });
      expect(dockerfileReads()).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("inspectRepoTree → reads the branch it was asked for", () => {
  beforeEach(() => {
    egressFetchMock.mockReset();
    // A binding whose stored default is `main` while the remote's real default
    // is `master` (traefik/whoami): the shape every public-URL binding had
    // before connectPublicRepo resolved the default.
    currentRow = {
      installationId: null,
      fullName: "traefik/whoami",
      defaultBranch: "main",
      providerRepoId: "public:github.com/traefik/whoami",
    };
  });

  /** Two branches with different trees; any other ref 404s like GitHub. */
  function serveBranches(branches: Record<string, Record<string, string>>) {
    egressFetchMock.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const tree = /\/git\/trees\/([^/]+)$/.exec(parsed.pathname);
      if (tree?.[1]) {
        const files = branches[decodeURIComponent(tree[1])];
        if (!files) return jsonResponse({ message: "Not Found" }, false, 404);
        return jsonResponse({
          tree: Object.keys(files).map((path) => ({ path, type: "blob", sha: path })),
        });
      }
      const file = /\/contents\/(.+)$/.exec(parsed.pathname)?.[1];
      const body = file ? branches[parsed.searchParams.get("ref") ?? ""]?.[file] : undefined;
      return body === undefined ? textResponse("Not Found", false, 404) : textResponse(body);
    });
  }

  it("inspects the picked branch's tree, Dockerfile and all, not the stored default", async () => {
    serveBranches({
      master: { Dockerfile: "FROM golang\nEXPOSE 80\n", "go.mod": "module whoami\n" },
      "release/2.x": { "package.json": JSON.stringify({ dependencies: { next: "15" } }) },
    });

    const onDefault = await inspectRepoTree({ gitRepoId: "gitr_whoami", path: "" });
    // The stored `main` does not exist upstream: an honest upstream error.
    expect(onDefault.isErr()).toBe(true);

    const master = await inspectRepoTree({ gitRepoId: "gitr_whoami", path: "", ref: "master" });
    expect(master.isOk()).toBe(true);
    if (!master.isOk()) return;
    expect(master.value.dockerfile).toEqual({ path: "Dockerfile", exposedPorts: [80] });

    // Same repo, another branch: its own snapshot, not master's cached one.
    const release = await inspectRepoTree({
      gitRepoId: "gitr_whoami",
      path: "",
      ref: "release/2.x",
    });
    expect(release.isOk()).toBe(true);
    if (!release.isOk()) return;
    expect(release.value.dockerfile).toBeNull();
    expect(release.value.framework).toBe("next");
    expect(
      egressFetchMock.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes("/git/trees/release%2F2.x"),
      ),
    ).toBe(true);
  });

  it("a blank ref falls back to the stored default branch", async () => {
    currentRow = {
      installationId: null,
      fullName: "traefik/whoami",
      defaultBranch: "master",
      providerRepoId: "public:github.com/traefik/whoami",
    };
    serveBranches({ master: { Dockerfile: "FROM nginx\n" } });

    const result = await inspectRepoTree({ gitRepoId: "gitr_whoami_blank", path: "", ref: " " });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.dockerfile?.path).toBe("Dockerfile");
  });
});
