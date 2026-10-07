/**
 * A compose stack can only be built from a repository the caller's
 * organization owns.
 *
 * `createComposeResource` (../create.ts) checks that the PROJECT is in the
 * caller's org, and `resolveRepoCloneBinding` (git/repo-binding.ts) resolves
 * the caller-supplied `gitRepoId` within that same organization, so a
 * repository bound through another organization's installation is treated as
 * not found.
 *
 * Real Postgres for the tenant chain (org -> git provider -> installation ->
 * repo). Only the two outbound seams are replaced: GitHub (`fetchBranchHead`)
 * and the build queue (`enqueueComposeBuild`), so the create runs to
 * completion instead of failing on network for an unrelated reason.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { resource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchBranchHead = vi.fn();
const enqueueComposeBuild = vi.fn();

vi.mock("../../../git/github-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../git/github-app")>()),
  fetchBranchHead,
}));
vi.mock("../build-trigger", () => ({ enqueueComposeBuild }));

const { createComposeResource } = await import("../create");
const { seedGitRepo, seedOrganization, seedProject, uniq } =
  await import("../../../__tests__/postgres-seed");

function stacksIn(projectId: ProjectId) {
  return db.select({ id: resource.id }).from(resource).where(eq(resource.projectId, projectId));
}

beforeEach(() => {
  fetchBranchHead.mockReset();
  fetchBranchHead.mockResolvedValue({
    sha: "0123456789abcdef0123456789abcdef01234567",
    message: "init",
    authorName: "a",
    authorAvatar: null,
  });
  enqueueComposeBuild.mockReset();
  enqueueComposeBuild.mockResolvedValue(undefined);
});

function createGitStack(input: {
  organizationId: Parameters<typeof createComposeResource>[0]["organizationId"];
  projectId: Parameters<typeof createComposeResource>[0]["input"]["projectId"];
  gitRepoId: string;
}) {
  return createComposeResource({
    organizationId: input.organizationId,
    log: createRequestLogger({ method: "TEST", path: "/compose/create" }),
    input: {
      projectId: input.projectId,
      name: `stack-${uniq()}`,
      source: "git",
      gitRepoId: input.gitRepoId,
      variables: [],
      exposed: [],
      deploy: true,
    },
  });
}

describe("compose create is bound to the caller's own repositories", () => {
  it("another org's gitRepoId is rejected by compose create", async () => {
    const repoOwner = await seedOrganization("repo-owner");
    const caller = await seedOrganization("repo-caller");
    const otherRepo = await seedGitRepo(repoOwner, `other-${uniq()}/private-app`);
    const { projectId } = await seedProject(caller);

    const result = await createGitStack({
      organizationId: caller,
      projectId,
      gitRepoId: otherRepo,
    });

    expect(result.isErr()).toBe(true);
    // Rejected before anything reached GitHub with the other org's
    // installation, and before a stack row bound to its repo was written.
    expect(fetchBranchHead).not.toHaveBeenCalled();
    expect(enqueueComposeBuild).not.toHaveBeenCalled();
    expect(await stacksIn(projectId)).toEqual([]);
  });

  // Control: the same create with the caller's OWN repo succeeds, so the case
  // above fails on the tenant check and not on setup or mocks.
  it("the caller's own gitRepoId is accepted by compose create", async () => {
    const org = await seedOrganization("repo-self");
    const repo = await seedGitRepo(org, `self-${uniq()}/app`);
    const { projectId } = await seedProject(org);

    const result = await createGitStack({ organizationId: org, projectId, gitRepoId: repo });

    expect(result.isOk()).toBe(true);
    expect(fetchBranchHead).toHaveBeenCalledOnce();
  });
});
