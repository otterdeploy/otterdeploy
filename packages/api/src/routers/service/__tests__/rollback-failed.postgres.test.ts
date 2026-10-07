/**
 * A rollback whose roll fails is a failed rollback.
 *
 * With two rollbacks fired at once, the runtime refused one roll ("removal of
 * container … is already in progress"). redeployOne folded that into an `error`
 * runtime and returned Ok, so rollbackService marked its row `running` and
 * answered 200 with the service `invalid`. Here the roll fails the simplest
 * real way, Docker unreachable (nothing on DOCKER_HOST), against a migrated
 * Postgres.
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, resource } from "@otterdeploy/db/schema/project";
import { desc, eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: the roll must fail on an unreachable Docker */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-rollback-failed.sock";
});

const { rollbackService } = await import("../rollback");
const { seedOrganization, seedProject, seedService } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/rollback-failed" });
const TARGET_IMAGE = "registry.example/web:good";

let ref: {
  organizationId: Awaited<ReturnType<typeof seedOrganization>>;
  projectId: Awaited<ReturnType<typeof seedProject>>["projectId"];
  resourceId: ResourceId;
};
let target: DeploymentId;

beforeAll(async () => {
  const organizationId = await seedOrganization("rollback-failed");
  const project = await seedProject(organizationId);
  const { resourceId } = await seedService({
    projectId: project.projectId,
    environmentId: project.mainEnvironmentId,
    name: "web",
  });
  ref = { organizationId, projectId: project.projectId, resourceId };
  const [row] = await db
    .insert(deployment)
    .values({ resourceId, image: TARGET_IMAGE, reason: "create", status: "running" })
    .returning({ id: deployment.id });
  if (!row) throw new Error("deployment insert returned no row");
  target = row.id;
});

describe("rollback when the roll fails", () => {
  it("answers a typed failure, fails its own row with the reason, never `running`", async () => {
    const result = await rollbackService({ ...ref, deploymentId: target }, log);
    expect(result.isErr() && result.error._tag).toBe("RollbackFailedError");

    const [rollbackRow] = await db
      .select({
        status: deployment.status,
        reason: deployment.reason,
        errorMessage: deployment.errorMessage,
      })
      .from(deployment)
      .where(eq(deployment.resourceId, ref.resourceId))
      .orderBy(desc(deployment.createdAt))
      .limit(1);
    expect(rollbackRow?.reason).toBe("rollback");
    expect(rollbackRow?.status).toBe("failed");
    // The runtime's own words, not a generic placeholder.
    expect(rollbackRow?.errorMessage).toMatch(/otterdeploy-rollback-failed\.sock|ENOENT|connect/);

    const [service] = await db
      .select({ status: resource.status })
      .from(resource)
      .where(eq(resource.id, ref.resourceId));
    expect(service?.status).toBe("invalid");
  });
});
