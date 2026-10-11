/**
 * A deployment credited its git commit author as the trigger: a Deploy clicked
 * by a person showed the bot that wrote the last commit. Who asked for a
 * deployment is now recorded on it, apart from the commit author, and the
 * deployment lists return both. Against a migrated Postgres; GitHub, the build
 * queue and build-target routing are replaced as in
 * build-double-click.postgres.test.ts.
 */
import { db } from "@otterdeploy/db";
import { user } from "@otterdeploy/db/schema/auth";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

const fetchBranchHead = vi.fn();
const triggerDeploy = vi.fn();

vi.mock("../../../git/github-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../git/github-app")>()),
  fetchBranchHead,
}));
vi.mock("@otterdeploy/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otterdeploy/jobs")>()),
  triggerDeploy,
}));
vi.mock("../../../lib/build-target", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/build-target")>()),
  resolveBuildTarget: async () => ({
    serverId: null,
    serverName: null,
    lane: "default",
    reason: "default",
  }),
  buildTargetUnavailable: async () => null,
  buildTargetBlocker: () => null,
}));

const { enqueueGitBuild } = await import("../manifest-apply-git");
const { listProjectDeployments } = await import("../../deployment/list-by-project");
const { seedGitRepo, seedOrganization, seedProject, seedService, uniq } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/project/deployment-trigger" });

describe("who triggered a deployment", () => {
  it("is the user who clicked Deploy, not the commit author", async () => {
    const organizationId = await seedOrganization("trigger");
    const { projectId, mainEnvironmentId } = await seedProject(organizationId);
    const gitRepoId = await seedGitRepo(organizationId, `acme/app-${uniq()}`);
    const { resourceId } = await seedService({
      projectId,
      environmentId: mainEnvironmentId,
      name: `web-${uniq()}`,
    });
    await db
      .update(serviceResource)
      .set({ gitRepoId, branch: "main" })
      .where(eq(serviceResource.resourceId, resourceId));
    const [ada] = await db
      .insert(user)
      .values({ id: `usr_${uniq()}`, name: "Ada Operator", email: `ada-${uniq()}@example.com` })
      .returning({ id: user.id });
    if (!ada) throw new Error("user insert returned no row");
    fetchBranchHead.mockResolvedValue({
      sha: "c".repeat(40),
      message: "chore: bump deps",
      authorName: "deps-bot[bot]",
      authorAvatar: null,
    });
    triggerDeploy.mockResolvedValue(undefined);

    const built = await enqueueGitBuild({
      projectId,
      organizationId,
      resourceId,
      reason: "create",
      triggeredByUserId: ada.id,
      log,
    });
    if (built.isErr()) throw new Error(built.error);
    // Settled, so the listing reads the stored row without asking the runtime.
    await db
      .update(deployment)
      .set({ status: "failed" })
      .where(eq(deployment.id, idSchema.deployment.parse(built.value.deploymentId)));

    const listed = await listProjectDeployments({
      projectId,
      organizationId,
      resourceId,
      limit: 10,
      offset: 0,
    });
    if (listed.isErr()) throw new Error(listed.error.message);
    expect(listed.value.items.map((d) => [d.triggeredBy?.name, d.gitCommitAuthor])).toEqual([
      ["Ada Operator", "deps-bot[bot]"],
    ]);
  });
});
