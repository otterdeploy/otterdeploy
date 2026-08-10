/**
 * od-5j8.8 — hostile-path coverage for the git-repo tenant boundary.
 *
 * `getRepoForOrg` is the guard every caller-supplied-`gitRepoId` endpoint
 * (getRepo, inspectRepo, listBranches, inspectEnv) now runs through before
 * touching repo contents or minting an installation token. Before this fix,
 * those endpoints resolved `gitRepoId` with no org check at all — org A could
 * read org B's private repo name/branch/tree/env files just by supplying
 * org B's `gitRepoId`.
 */
import type { GitRepoId, OrganizationId } from "@otterdeploy/shared/id";

import { describe, expect, test, vi } from "vite-plus/test";

// oxlint-disable-next-line node/no-process-env -- test env setup boundary: satisfy required vars so the module graph (which imports @otterdeploy/db) loads.
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

interface FixtureRow {
  id: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  cloneUrl: string;
  installationId: string | null;
  providerOrganizationId: string | null;
}

// Mutable fixture the mocked select().from().leftJoin().leftJoin().where().limit()
// chain reads from at call time — `limit` is a function (not a resolved
// promise) so each test's `setDbRow` is honored even though the chain object
// itself is only built once. Same shape as the guards in
// authz/__tests__/project-scope-guards.test.ts, extended with leftJoin for
// the installation → provider hop `getRepoForOrg` needs.
let currentRow: FixtureRow | undefined;
function setDbRow(row: FixtureRow | undefined) {
  currentRow = row;
}

/** The subset of drizzle's select builder `getRepoForOrg` touches. */
interface SelectChain {
  from: () => SelectChain;
  leftJoin: () => SelectChain;
  where: () => SelectChain;
  limit: () => Promise<FixtureRow[]>;
}
const passthrough = () => chain;
const chain: SelectChain = {
  from: passthrough,
  leftJoin: passthrough,
  where: passthrough,
  limit: () => Promise.resolve(currentRow ? [currentRow] : []),
};

vi.mock("@otterdeploy/db", () => ({
  db: { select: () => chain },
}));

const { getRepoForOrg } = await import("../queries");

const orgA = "org_a" as OrganizationId;
const orgB = "org_b" as OrganizationId;
const repoId = "gitrepo_victim" as GitRepoId;

describe("getRepoForOrg (git tenant boundary — od-5j8.8)", () => {
  test("private (installation-backed) repo: same-org lookup succeeds", async () => {
    setDbRow({
      id: repoId,
      fullName: "acme/private-app",
      defaultBranch: "main",
      isPrivate: true,
      cloneUrl: "https://github.com/acme/private-app.git",
      installationId: "gitinst_1",
      providerOrganizationId: orgA,
    });

    const row = await getRepoForOrg({ gitRepoId: repoId, organizationId: orgA });
    expect(row).toMatchObject({ fullName: "acme/private-app" });
  });

  test("private repo owned by org A: org B's lookup returns undefined (404, not a leak)", async () => {
    setDbRow({
      id: repoId,
      fullName: "acme/private-app",
      defaultBranch: "main",
      isPrivate: true,
      cloneUrl: "https://github.com/acme/private-app.git",
      installationId: "gitinst_1",
      providerOrganizationId: orgA,
    });

    const row = await getRepoForOrg({ gitRepoId: repoId, organizationId: orgB });
    expect(row).toBeUndefined();
  });

  test("nonexistent repo id: also undefined — indistinguishable from a foreign one", async () => {
    setDbRow(undefined);
    const row = await getRepoForOrg({ gitRepoId: repoId, organizationId: orgA });
    expect(row).toBeUndefined();
  });

  test("public-URL repo (no installation): any org may read it — by design (see public-repos.ts)", async () => {
    setDbRow({
      id: repoId,
      fullName: "torvalds/linux",
      defaultBranch: "master",
      isPrivate: false,
      cloneUrl: "https://github.com/torvalds/linux.git",
      installationId: null,
      providerOrganizationId: null,
    });

    const rowForA = await getRepoForOrg({ gitRepoId: repoId, organizationId: orgA });
    const rowForB = await getRepoForOrg({ gitRepoId: repoId, organizationId: orgB });
    expect(rowForA).toMatchObject({ fullName: "torvalds/linux" });
    expect(rowForB).toMatchObject({ fullName: "torvalds/linux" });
  });
});
