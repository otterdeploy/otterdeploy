/**
 * Env.create only attaches an environment to a project of the
 * caller's own organization.
 *
 * Before: `createEnv` inserted the row with the caller's `projectId` verbatim.
 * Nothing checked the project's org (the API-key scope guard only constrains
 * keys, and the `environment.project_id` FK only proves the project exists
 * somewhere), so an org that learned another org's project id could add an
 * environment to it, and the victim's environment list showed it.
 *
 * After: a project outside the caller's org is refused with the same
 * ProjectNotFoundError as a project that does not exist, before anything is
 * written.
 *
 * Drives the real create path against a migrated Postgres.
 */
import { db } from "@otterdeploy/db";
import { environment } from "@otterdeploy/db/schema/project";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { and, eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { ProjectNotFoundError } from "../../project/errors";
import { createEnv, listEnvs } from "../handlers";

describe("env.create stays inside the caller's organization", () => {
  test("another org's project is refused exactly like a project that does not exist", async () => {
    const victim = await seedOrganization("envcreate-victim");
    const attacker = await seedOrganization("envcreate-attacker");
    const target = await seedProject(victim);
    const before = await listEnvs({ organizationId: victim, projectId: target.projectId });
    const slug = `injected-${uniq()}`;

    const foreign = await createEnv({
      name: "injected",
      slug,
      projectId: target.projectId,
      organizationId: attacker,
    });
    const missingProjectId = createId(ID_PREFIX.project);
    const missing = await createEnv({
      name: "injected",
      slug,
      projectId: missingProjectId,
      organizationId: attacker,
    });

    expect(foreign.isErr() && foreign.error).toBeInstanceOf(ProjectNotFoundError);
    expect(missing.isErr() && missing.error).toBeInstanceOf(ProjectNotFoundError);
    // Same message shape: only the id the caller sent differs.
    expect(foreign.isErr() && foreign.error.message).toBe(
      new ProjectNotFoundError({ projectId: target.projectId }).message,
    );
    expect(missing.isErr() && missing.error.message).toBe(
      new ProjectNotFoundError({ projectId: missingProjectId }).message,
    );

    // Nothing was written: the victim's project has exactly what it had.
    expect(await listEnvs({ organizationId: victim, projectId: target.projectId })).toEqual(before);
    expect(
      await db
        .select({ id: environment.id })
        .from(environment)
        .where(and(eq(environment.projectId, target.projectId), eq(environment.slug, slug))),
    ).toEqual([]);
  });

  test("its own project, and a standalone environment, are still created", async () => {
    const organizationId = await seedOrganization("envcreate-own");
    const own = await seedProject(organizationId);

    const attached = await createEnv({
      name: "Staging",
      slug: `staging-${uniq()}`,
      projectId: own.projectId,
      organizationId,
    });
    expect(attached.isOk() && attached.value.projectId).toBe(own.projectId);

    const standalone = await createEnv({
      name: "production",
      slug: "production",
      organizationId,
    });
    expect(standalone.isOk() && standalone.value).toMatchObject({
      projectId: null,
      claimableByOrganizationId: organizationId,
    });
  });
});
