/**
 * A double click on Deploy opens ONE deployment.
 *
 * `service.build` fired from a session and an API key at the same instant: both
 * read "nothing in flight for this SHA" and both inserted a pending row, so one
 * commit built twice. Here `enqueueGitBuild` races itself against a migrated
 * Postgres. Only the outbound seams are replaced: GitHub (`fetchBranchHead`),
 * the build queue (`triggerDeploy`) and the build-target routing, which reads
 * builder liveness from Redis.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
const { seedGitRepo, seedOrganization, seedProject, seedService, uniq } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/project/build-double-click" });
const ROUNDS = 10;
const SHA = "0123456789abcdef0123456789abcdef01234567";

let organizationId: Awaited<ReturnType<typeof seedOrganization>>;
let projectId: Awaited<ReturnType<typeof seedProject>>["projectId"];
let environmentId: Awaited<ReturnType<typeof seedProject>>["mainEnvironmentId"];
let gitRepoId: Awaited<ReturnType<typeof seedGitRepo>>;

async function gitService(): Promise<ResourceId> {
  const { resourceId } = await seedService({ projectId, environmentId, name: `web-${uniq()}` });
  await db
    .update(serviceResource)
    .set({ gitRepoId, branch: "main" })
    .where(eq(serviceResource.resourceId, resourceId));
  return resourceId;
}

function build(resourceId: ResourceId, noCache = false) {
  return enqueueGitBuild({ projectId, organizationId, resourceId, noCache, log });
}

async function rowsOf(resourceId: ResourceId) {
  return db
    .select({ id: deployment.id })
    .from(deployment)
    .where(eq(deployment.resourceId, resourceId));
}

beforeAll(async () => {
  organizationId = await seedOrganization("double-click");
  const project = await seedProject(organizationId);
  projectId = project.projectId;
  environmentId = project.mainEnvironmentId;
  gitRepoId = await seedGitRepo(organizationId, `acme/app-${uniq()}`);
});

beforeEach(() => {
  fetchBranchHead.mockReset();
  fetchBranchHead.mockResolvedValue({
    sha: SHA,
    message: "init",
    authorName: "a",
    authorAvatar: null,
  });
  triggerDeploy.mockReset();
  triggerDeploy.mockResolvedValue(undefined);
});

describe("deploy twice at once", () => {
  it("two clicks name the same deployment, and one row exists", async () => {
    const outcomes: Array<{ ids: number; rows: number }> = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const resourceId = await gitService();
      const [a, b] = await Promise.all([build(resourceId), build(resourceId)]);
      const ids = new Set([a, b].flatMap((r) => (r.isOk() ? [r.value.deploymentId] : [])));
      outcomes.push({ ids: ids.size, rows: (await rowsOf(resourceId)).length });
    }
    expect(outcomes).toEqual(Array.from({ length: ROUNDS }, () => ({ ids: 1, rows: 1 })));
    // The second click reused the first's build: one job queued per round.
    expect(triggerDeploy).toHaveBeenCalledTimes(ROUNDS);
  });

  it("a cache bypass still builds fresh beside an in-flight build", async () => {
    const resourceId = await gitService();
    const first = await build(resourceId);
    const fresh = await build(resourceId, true);
    expect(first.isOk() && fresh.isOk()).toBe(true);
    if (first.isOk() && fresh.isOk()) {
      expect(fresh.value.deploymentId).not.toBe(first.value.deploymentId);
    }
    expect(await rowsOf(resourceId)).toHaveLength(2);
  });
});
