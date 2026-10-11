/**
 * A manual Redeploy of a git service was recorded as its first deploy: reason
 * `create`, shown as "Initial deploy", identical to the deployment it
 * replaced. History could not tell the two apart. Deploy now records
 * `redeploy` once the service has any deployment, and `create` only for its
 * first. Against a migrated Postgres; GitHub, the build queue and build-target
 * routing are replaced as in build-double-click.postgres.test.ts.
 */
import { db } from "@otterdeploy/db";
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
const { gitBuildReason } = await import("../deployments");
const { seedGitRepo, seedOrganization, seedProject, seedService, uniq } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/project/git-build-reason" });

describe("the reason a git build records", () => {
  it("is create for the first build and redeploy for a later Deploy", async () => {
    const organizationId = await seedOrganization("build-reason");
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
    triggerDeploy.mockResolvedValue(undefined);

    const deploy = async (sha: string) => {
      fetchBranchHead.mockResolvedValue({ sha, message: "m", authorName: "a", authorAvatar: null });
      const reason = await gitBuildReason(resourceId);
      const built = await enqueueGitBuild({ projectId, organizationId, resourceId, reason, log });
      if (built.isErr()) throw new Error(built.error);
      const [row] = await db
        .select({ reason: deployment.reason })
        .from(deployment)
        .where(eq(deployment.id, idSchema.deployment.parse(built.value.deploymentId)));
      return row?.reason;
    };

    expect(await deploy("a".repeat(40))).toBe("create");
    expect(await deploy("b".repeat(40))).toBe("redeploy");
  });
});
