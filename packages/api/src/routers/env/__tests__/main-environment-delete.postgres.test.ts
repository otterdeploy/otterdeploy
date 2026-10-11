/**
 * A project's main environment cannot be deleted on its own.
 *
 * `project.environment_id` is the pointer every scoped read resolves through:
 * with it null, `resolveEnvironmentScope` returns null and each caller reads
 * that as "this project has no resources". Deleting the main environment used
 * to null that pointer, so the project reported itself empty in the dashboard,
 * the graph and the CLI from then on, while its containers kept running.
 * Nothing in the product sets the pointer back.
 *
 * Deleting the project is what removes its main environment. A delete of the
 * main environment alone is refused with its own error, not the not-empty
 * conflict, because no `cascade` retry can make it succeed.
 *
 * Drives the real delete path against a migrated Postgres.
 */
import type { EnvironmentId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";

import {
  seedEnvironment,
  seedOrganization,
  seedProject,
  uniq,
} from "../../../__tests__/postgres-seed";
import { deleteEnv } from "../handlers";

async function mainPointerOf(projectId: ProjectId) {
  const [row] = await db
    .select({ environmentId: project.environmentId })
    .from(project)
    .where(eq(project.id, projectId));
  return row?.environmentId;
}

async function environmentExists(environmentId: EnvironmentId) {
  const rows = await db
    .select({ id: environment.id })
    .from(environment)
    .where(eq(environment.id, environmentId));
  return rows.length === 1;
}

describe("env.delete on a project's main environment", () => {
  test("is refused, and the project keeps its main environment", async () => {
    const organizationId = await seedOrganization("envdelete-main");
    const seeded = await seedProject(organizationId);

    const result = await deleteEnv({ id: seeded.mainEnvironmentId, organizationId });

    expect(result.isErr() && result.error._tag).toBe("EnvironmentIsMainError");
    expect(await environmentExists(seeded.mainEnvironmentId)).toBe(true);
    expect(await mainPointerOf(seeded.projectId)).toBe(seeded.mainEnvironmentId);
  });

  test("is refused with cascade too, because cascade is not what resolves it", async () => {
    const organizationId = await seedOrganization("envdelete-main-cascade");
    const seeded = await seedProject(organizationId);

    const result = await deleteEnv({
      id: seeded.mainEnvironmentId,
      organizationId,
      cascade: true,
    });

    expect(result.isErr() && result.error._tag).toBe("EnvironmentIsMainError");
    expect(await mainPointerOf(seeded.projectId)).toBe(seeded.mainEnvironmentId);
  });

  test("another environment of the same project still deletes", async () => {
    const organizationId = await seedOrganization("envdelete-other");
    const seeded = await seedProject(organizationId);
    const staging = await seedEnvironment(seeded.projectId, `staging-${uniq()}`);

    const result = await deleteEnv({ id: staging, organizationId });

    expect(result.isOk()).toBe(true);
    expect(await environmentExists(staging)).toBe(false);
    expect(await mainPointerOf(seeded.projectId)).toBe(seeded.mainEnvironmentId);
  });
});
