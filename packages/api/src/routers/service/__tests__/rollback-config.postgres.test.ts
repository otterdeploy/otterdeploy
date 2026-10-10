/**
 * Rolling back after a failed push that changed the port.
 *
 * `web` ran a good build on port 80; a second push changed the port to 3000
 * and failed its build. The apply had already written port 3000 to the
 * service row, and the rollback swapped only the image back, so the last good
 * image was health-checked on 3000 and never became ready: "nothing accepted
 * a connection on port 3000 … the app is listening on [::]:80 instead". A
 * rollback must restore the config the target ran with together with its
 * image.
 *
 * Also: two rollbacks of one service at once raced two cutovers of the same
 * container ("removal of container … is already in progress"); the second is
 * now refused while the first is rolling.
 *
 * The roll itself fails here (no Docker on DOCKER_HOST); what is pinned is
 * what the rollback wrote before and around it, against a migrated Postgres.
 */
import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { deployment, serviceResource } from "@otterdeploy/db/schema/project";
import { and, desc, eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: no real Docker in this suite */
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-rollback-config.sock";
});

const { rollbackService } = await import("../rollback");
const { configFromSnapshot, recordDeploymentConfig, readServiceConfig } =
  await import("../config-snapshot");
const { replaceServicePorts, listServicePorts } = await import("../queries");
const { seedOrganization, seedProject, seedService } =
  await import("../../../__tests__/postgres-seed");

const log = createRequestLogger({ method: "TEST", path: "/service/rollback-config" });
const GOOD_IMAGE = "registry.example/web:good";

interface Ref {
  organizationId: Awaited<ReturnType<typeof seedOrganization>>;
  projectId: Awaited<ReturnType<typeof seedProject>>["projectId"];
  resourceId: ResourceId;
}

async function seed(name: string): Promise<Ref> {
  const organizationId = await seedOrganization(name);
  const project = await seedProject(organizationId);
  const { resourceId } = await seedService({
    projectId: project.projectId,
    environmentId: project.mainEnvironmentId,
    name: "web",
  });
  return { organizationId, projectId: project.projectId, resourceId };
}

/** A settled good deploy on port 80, its config recorded the way the builder
 *  records it right before the rollout. */
async function goodDeployOnPort80(resourceId: ResourceId): Promise<DeploymentId> {
  await replaceServicePorts(resourceId, [{ containerPort: 80, isPrimary: true }]);
  await db
    .update(serviceResource)
    .set({ image: GOOD_IMAGE })
    .where(eq(serviceResource.resourceId, resourceId));
  const [row] = await db
    .insert(deployment)
    .values({ resourceId, image: GOOD_IMAGE, reason: "create", status: "building" })
    .returning({ id: deployment.id });
  if (!row) throw new Error("deployment insert returned no row");
  await recordDeploymentConfig(row.id, resourceId);
  await db.update(deployment).set({ status: "running" }).where(eq(deployment.id, row.id));
  return row.id;
}

/** The broken push: the apply lands port 3000 on the row, then the build fails. */
async function brokenPushOnPort3000(resourceId: ResourceId): Promise<void> {
  await replaceServicePorts(resourceId, [{ containerPort: 3000, isPrimary: true }]);
  await db.insert(deployment).values({
    resourceId,
    image: "pending:upload",
    reason: "create",
    status: "failed",
    errorMessage: "error TS2322",
  });
}

describe("a rollback restores the config its target ran with", () => {
  let ref: Ref;
  let good: DeploymentId;

  beforeAll(async () => {
    ref = await seed("rollback-config");
    good = await goodDeployOnPort80(ref.resourceId);
    await brokenPushOnPort3000(ref.resourceId);
  });

  it("records the rolled-out config on the deployment", async () => {
    const [row] = await db
      .select({ snapshot: deployment.snapshot })
      .from(deployment)
      .where(eq(deployment.id, good));
    expect(configFromSnapshot(row?.snapshot ?? {})?.ports).toEqual([
      { containerPort: 80, protocol: "tcp", appProtocol: "http", isPrimary: true },
    ]);
  });

  it("puts port 80 back with the good image, and the rollback row says so", async () => {
    await rollbackService({ ...ref, deploymentId: good }, log);

    const ports = await listServicePorts(ref.resourceId);
    expect(ports.map((p) => p.containerPort)).toEqual([80]);
    const [service] = await db
      .select({ image: serviceResource.image })
      .from(serviceResource)
      .where(eq(serviceResource.resourceId, ref.resourceId));
    expect(service?.image).toBe(GOOD_IMAGE);

    const [rollbackRow] = await db
      .select({ snapshot: deployment.snapshot })
      .from(deployment)
      .where(and(eq(deployment.resourceId, ref.resourceId), eq(deployment.reason, "rollback")))
      .orderBy(desc(deployment.createdAt))
      .limit(1);
    expect(configFromSnapshot(rollbackRow?.snapshot ?? {})).toEqual(
      await readServiceConfig(ref.resourceId),
    );
  });
});

describe("one rollback of a service at a time", () => {
  it("refuses a second rollback while the first is still rolling", async () => {
    const ref = await seed("rollback-serial");
    const good = await goodDeployOnPort80(ref.resourceId);
    await db.insert(deployment).values({
      resourceId: ref.resourceId,
      image: GOOD_IMAGE,
      reason: "rollback",
      status: "building",
    });
    const before = await db
      .select({ id: deployment.id })
      .from(deployment)
      .where(eq(deployment.resourceId, ref.resourceId));

    const result = await rollbackService({ ...ref, deploymentId: good }, log);
    expect(result.isErr() && result.error._tag).toBe("NotRollbackableError");
    expect(result.isErr() && result.error.message).toMatch(/already rolling out/);
    const after = await db
      .select({ id: deployment.id })
      .from(deployment)
      .where(eq(deployment.resourceId, ref.resourceId));
    expect(after).toHaveLength(before.length);
  });
});
