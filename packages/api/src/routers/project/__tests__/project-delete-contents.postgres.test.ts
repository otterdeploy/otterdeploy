import { db } from "@otterdeploy/db";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  seedEnvironment,
  seedOrganization,
  seedProject,
  seedService,
  uniq,
} from "../../../__tests__/postgres-seed";
import { createComposeRecord } from "../../compose/queries";
import { deleteProject } from "../projects";

// Real database and resource teardown orchestration; host operations are
// replaced so tests never contact an installation's Docker/Caddy.
vi.mock("../../../runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../runtime")>();
  return {
    ...actual,
    runtime: () => ({ ...actual.runtime(), destroy: vi.fn(async () => undefined) }),
  };
});
vi.mock("../../../swarm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../swarm")>()),
  removeComposeStack: vi.fn(async () => undefined),
}));
vi.mock("../../../caddy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../caddy")>()),
  reconcile: vi.fn(async () => ({ applied: [], skipped: [] })),
}));
vi.mock("../project-networks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../project-networks")>()),
  removeProjectNetworks: vi.fn(async () => ({ removed: [], deferred: [] })),
}));
vi.mock("../../service/teardown", () => ({
  reclaimServiceHostArtifacts: vi.fn(async () => undefined),
  reclaimDatabaseVolume: vi.fn(async () => undefined),
}));

const log = createRequestLogger({ method: "DELETE", path: "/test/project" });
describe("whole-project delete", () => {
  it("deletes services and stacks across environments without affecting another project", async () => {
    const organizationId = await seedOrganization("whole-delete");
    const target = await seedProject(organizationId);
    const other = await seedProject(organizationId);
    const staging = await seedEnvironment(target.projectId, "staging");
    const stack = await createComposeRecord({
      projectId: target.projectId,
      environmentId: target.mainEnvironmentId,
      name: `stack-${uniq()}`,
      source: "git",
      composeContent: "services:\n  web:\n    image: nginx:alpine\n",
      stackName: `stack-${uniq()}`,
      services: [],
    });
    await seedService({
      projectId: target.projectId,
      environmentId: target.mainEnvironmentId,
      name: `child-${uniq()}`,
      stackId: stack.resource.id,
      composeService: "web",
    });
    await seedService({
      projectId: target.projectId,
      environmentId: staging,
      name: `stage-${uniq()}`,
    });
    const kept = await seedService({
      projectId: other.projectId,
      environmentId: other.mainEnvironmentId,
      name: `kept-${uniq()}`,
    });
    expect((await deleteProject({ id: target.projectId, organizationId }, log)).isErr()).toBe(true);
    expect(
      (
        await deleteProject({ id: target.projectId, organizationId, deleteContents: true }, log)
      ).isOk(),
    ).toBe(true);
    expect(await db.select().from(project).where(eq(project.id, target.projectId))).toEqual([]);
    expect(
      await db.select().from(resource).where(eq(resource.projectId, target.projectId)),
    ).toEqual([]);
    expect(
      await db.select().from(environment).where(eq(environment.projectId, target.projectId)),
    ).toEqual([]);
    expect(await db.select().from(resource).where(eq(resource.id, kept.resourceId))).toHaveLength(
      1,
    );
  });
  it("refuses another organization's project before touching its resources", async () => {
    const owner = await seedOrganization("delete-owner");
    const outsider = await seedOrganization("delete-outsider");
    const target = await seedProject(owner);
    const kept = await seedService({
      projectId: target.projectId,
      environmentId: target.mainEnvironmentId,
      name: `kept-${uniq()}`,
    });
    expect(
      (
        await deleteProject(
          { id: target.projectId, organizationId: outsider, deleteContents: true },
          log,
        )
      ).isErr(),
    ).toBe(true);
    expect(await db.select().from(resource).where(eq(resource.id, kept.resourceId))).toHaveLength(
      1,
    );
  });
  it("keeps the project when an incomplete resource cannot be torn down", async () => {
    const organizationId = await seedOrganization("delete-incomplete");
    const target = await seedProject(organizationId);
    await db.insert(resource).values({
      projectId: target.projectId,
      environmentId: target.mainEnvironmentId,
      name: "incomplete-service",
      type: "service",
    });
    const deleted = await deleteProject(
      { id: target.projectId, organizationId, deleteContents: true },
      log,
    );
    expect(deleted.isErr()).toBe(true);
    if (deleted.isErr()) expect(deleted.error.message).toContain("incomplete-service");
    expect(await db.select().from(project).where(eq(project.id, target.projectId))).toHaveLength(1);
    expect(
      await db.select().from(resource).where(eq(resource.projectId, target.projectId)),
    ).toHaveLength(1);
  });
});
