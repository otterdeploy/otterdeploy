/**
 * Against a migrated Postgres: `resource.delete` deletes a
 * compose stack.
 *
 * It used to answer NOT_FOUND for any stack ("stack deletion is
 * compose.delete's job"), so a client deleting a project's resources the
 * generic way never removed the stack, and `project.delete` then refused the
 * project for still holding it: the project and its network leaked for every
 * compose app deleted that way.
 */
import { db } from "@otterdeploy/db";
import { resource, serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { createComposeRecord, getComposeRecord } from "../../compose/queries";
import { deleteProjectResource } from "../resources";

const { dataDir } = vi.hoisted(() => {
  const dir = `/tmp/od-delete-stack-${process.pid}`;
  /* oxlint-disable node/no-process-env -- test env boundary: host dirs go to scratch, and teardown must fail fast instead of dialling a real Docker daemon or Caddy */
  process.env.OTTERDEPLOY_DATA_DIR = dir;
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-delete-stack.sock";
  process.env.CADDY_ADMIN_URL = "unix:///nonexistent/otterdeploy-delete-stack-caddy.sock";
  /* oxlint-enable node/no-process-env */
  return { dataDir: dir };
});

// The swarm teardown is the daemon's half, covered by its own tests; what
// this file pins is that the generic delete runs the stack teardown at all.
vi.mock("../../../swarm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../swarm")>()),
  removeComposeStack: vi.fn(async () => undefined),
}));

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const log = {
  set: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
  emit: () => null,
  getContext: () => ({}),
};

describe("resource.delete on a compose stack", () => {
  it("deletes the stack and every child it owns", async () => {
    const organizationId = await seedOrganization("delstack");
    const { projectId, mainEnvironmentId } = await seedProject(organizationId);
    const stack = await createComposeRecord({
      projectId,
      environmentId: mainEnvironmentId,
      name: `immich-${uniq()}`,
      source: "git",
      composeContent: "services:\n  server:\n    image: nginx:alpine\n",
      stackName: `immich-${uniq()}`,
      services: [],
    });
    const child = await seedService({
      projectId,
      environmentId: mainEnvironmentId,
      name: `immich-server-${uniq()}`,
      stackId: stack.resource.id,
      composeService: "server",
    });

    const deleted = await deleteProjectResource(
      { projectId, organizationId, resourceId: stack.resource.id },
      log,
    );

    expect(deleted.isOk()).toBe(true);
    expect(await getComposeRecord(projectId, stack.resource.id)).toBeNull();
    const left = await db
      .select({ id: resource.id })
      .from(resource)
      .where(eq(resource.projectId, projectId));
    expect(left).toEqual([]);
    const children = await db
      .select({ id: serviceResource.resourceId })
      .from(serviceResource)
      .where(eq(serviceResource.resourceId, child.resourceId));
    expect(children).toEqual([]);
  });
});
