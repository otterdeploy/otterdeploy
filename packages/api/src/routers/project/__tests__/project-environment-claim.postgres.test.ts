/**
 * Who may take an environment as a new project's
 * main environment, and what the database holds the main pointer to.
 *
 * Before: `project.create` claimed a supplied environment id with
 * `UPDATE environment SET project_id = <new> WHERE id = <id> AND project_id IS
 * NULL`. A standalone row carried no organization, so any org that learned the
 * id adopted another org's environment. An id another project already held
 * fell through to a plain insert of that id and died on the primary key, which
 * the create's unique-violation catch reported as a slug CONFLICT for a slug
 * nobody held, suggesting a "free" slug that failed the same way forever. And
 * `project.environment_id` had no foreign key at all.
 *
 * After: a standalone environment records the org that made it
 * (`claimable_by_organization_id`), only that org's create claims it, and every
 * other taken id gets one typed refusal, written before anything else is. The
 * main pointer is held by `project_main_environment_in_project_fk`.
 *
 * Drives the real create path against a migrated Postgres.
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project } from "@otterdeploy/db/schema/project";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";

import {
  seedEnvironment,
  seedOrganization,
  seedProject,
  uniq,
} from "../../../__tests__/postgres-seed";
import { pgErrorInfo } from "../../../lib/pg-error";
import { createEnv, deleteEnv } from "../../env/handlers";
import { ProjectEnvironmentUnavailableError } from "../errors";
import { createProject } from "../projects";

const FK = "project_main_environment_in_project_fk";

/** A standalone environment, made the way the web onboarding makes it. */
async function standaloneEnvironment(organizationId: OrganizationId): Promise<EnvironmentId> {
  const created = await createEnv({
    id: createId(ID_PREFIX.environment),
    name: "production",
    slug: "production",
    organizationId,
  });
  if (created.isErr()) throw new Error(`standalone env: ${created.error.message}`);
  return created.value.id;
}

async function environmentRow(id: EnvironmentId) {
  const [row] = await db.select().from(environment).where(eq(environment.id, id));
  return row;
}

async function projectsWithSlug(slug: string) {
  return db.select({ id: project.id }).from(project).where(eq(project.slug, slug));
}

/** The refusal create answers, with nothing about who holds the id. */
async function expectRefused(organizationId: OrganizationId, environmentId: EnvironmentId) {
  const slug = `p-${uniq()}`;
  const created = await createProject({ organizationId, name: slug, slug, environmentId });
  expect(created.isErr() && created.error).toBeInstanceOf(ProjectEnvironmentUnavailableError);
  if (created.isErr()) {
    expect(created.error.message).toBe(
      new ProjectEnvironmentUnavailableError({ environmentId }).message,
    );
  }
  // Refused before anything was written: no project, and the slug stays free.
  expect(await projectsWithSlug(slug)).toEqual([]);
}

describe("project.create claims only its own org's standalone environment", () => {
  test("another org's standalone environment is refused and left exactly as it was", async () => {
    const owner = await seedOrganization("claim-owner");
    const thief = await seedOrganization("claim-thief");
    const environmentId = await standaloneEnvironment(owner);
    const before = await environmentRow(environmentId);
    expect(before).toMatchObject({ projectId: null, claimableByOrganizationId: owner });

    await expectRefused(thief, environmentId);

    expect(await environmentRow(environmentId)).toEqual(before);
    // ...and its own org can still claim it afterwards.
    const slug = `p-${uniq()}`;
    const created = await createProject({ organizationId: owner, name: slug, slug, environmentId });
    expect(created.isOk() && created.value.environmentId).toBe(environmentId);
  });

  test("an id another project already holds is a typed refusal, not a bogus slug conflict", async () => {
    const organizationId = await seedOrganization("claim-taken");
    const other = await seedOrganization("claim-taken-other");
    const ownSibling = await seedProject(organizationId);
    const foreign = await seedProject(other);
    const ownStaging = await seedEnvironment(ownSibling.projectId, `staging-${uniq()}`);

    // Same org and another org, main and non-main: one answer for all of them.
    for (const environmentId of [
      ownSibling.mainEnvironmentId,
      ownStaging,
      foreign.mainEnvironmentId,
    ]) {
      await expectRefused(organizationId, environmentId);
    }
    expect((await environmentRow(foreign.mainEnvironmentId))?.projectId).toBe(foreign.projectId);
    expect((await environmentRow(ownStaging))?.projectId).toBe(ownSibling.projectId);
  });

  test("a standalone environment older than claim ownership is claimable by no one", async () => {
    const organizationId = await seedOrganization("claim-legacy");
    const environmentId = createId(ID_PREFIX.environment);
    await db
      .insert(environment)
      .values({ id: environmentId, name: "production", slug: "production" });

    await expectRefused(organizationId, environmentId);
    expect(await environmentRow(environmentId)).toMatchObject({
      projectId: null,
      claimableByOrganizationId: null,
    });
  });

  test("its own standalone environment is claimed, keeping its name, and stops being claimable", async () => {
    const organizationId = await seedOrganization("claim-own");
    const environmentId = createId(ID_PREFIX.environment);
    const made = await createEnv({
      id: environmentId,
      name: "Live",
      slug: "live",
      organizationId,
    });
    expect(made.isOk()).toBe(true);

    const slug = `p-${uniq()}`;
    const created = await createProject({ organizationId, name: slug, slug, environmentId });
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    expect(created.value.environmentId).toBe(environmentId);
    expect(await environmentRow(environmentId)).toMatchObject({
      projectId: created.value.id,
      name: "Live",
      slug: "live",
      claimableByOrganizationId: null,
    });
  });

  test("a fresh id becomes the new project's main environment", async () => {
    const organizationId = await seedOrganization("claim-fresh");
    const environmentId = createId(ID_PREFIX.environment);
    const slug = `p-${uniq()}`;
    const created = await createProject({ organizationId, name: slug, slug, environmentId });
    expect(created.isOk()).toBe(true);
    if (created.isErr()) return;
    expect(created.value.environmentId).toBe(environmentId);
    expect(await environmentRow(environmentId)).toMatchObject({
      projectId: created.value.id,
      slug: "production",
      claimableByOrganizationId: null,
    });
  });

  test("two creates racing for one standalone environment: one claims it, one is refused", async () => {
    const organizationId = await seedOrganization("claim-race");
    const environmentId = await standaloneEnvironment(organizationId);
    const slugs = [`a-${uniq()}`, `b-${uniq()}`];

    const outcomes = await Promise.all(
      slugs.map((slug) => createProject({ organizationId, name: slug, slug, environmentId })),
    );

    expect(outcomes.filter((o) => o.isOk())).toHaveLength(1);
    const refused = outcomes.find((o) => o.isErr());
    expect(refused?.isErr() && refused.error).toBeInstanceOf(ProjectEnvironmentUnavailableError);
    const winner = outcomes.find((o) => o.isOk());
    expect((await environmentRow(environmentId))?.projectId).toBe(
      winner?.isOk() ? winner.value.id : "no winner",
    );
  });

  test("the database refuses a claimed environment that is still marked claimable", async () => {
    const organizationId = await seedOrganization("claim-check");
    const seeded = await seedProject(organizationId);
    const outcome = await Result.tryPromise({
      try: () =>
        db
          .update(environment)
          .set({ claimableByOrganizationId: organizationId })
          .where(eq(environment.id, seeded.mainEnvironmentId)),
      catch: (error: unknown) => error,
    });
    const info = outcome.isErr() ? pgErrorInfo(outcome.error) : null;
    expect(info?.constraint).toBe("environment_claimable_only_while_standalone");
  });
});

describe("the main-environment pointer is held by a foreign key", () => {
  /** The SQLSTATE + constraint of a pointer write that should not land. */
  async function pointerRefusal(projectId: ProjectId, environmentId: EnvironmentId | null) {
    const outcome = await Result.tryPromise({
      try: () => db.update(project).set({ environmentId }).where(eq(project.id, projectId)),
      catch: (error: unknown) => error,
    });
    const info = outcome.isErr() ? pgErrorInfo(outcome.error) : null;
    return { code: info?.code ?? null, constraint: info?.constraint ?? null };
  }

  test("a pointer to another project's environment, or to nothing, is refused", async () => {
    const organizationId = await seedOrganization("main-fk");
    const own = await seedProject(organizationId);
    const sibling = await seedProject(organizationId);
    const foreign = await seedProject(await seedOrganization("main-fk-other"));
    const standalone = await standaloneEnvironment(organizationId);

    for (const environmentId of [
      sibling.mainEnvironmentId,
      foreign.mainEnvironmentId,
      standalone,
      createId(ID_PREFIX.environment),
    ]) {
      expect(await pointerRefusal(own.projectId, environmentId)).toEqual({
        code: "23503",
        constraint: FK,
      });
    }
    const [row] = await db
      .select({ environmentId: project.environmentId })
      .from(project)
      .where(eq(project.id, own.projectId));
    expect(row?.environmentId).toBe(own.mainEnvironmentId);
  });

  test("the project's own environments, and no pointer at all, are accepted", async () => {
    const organizationId = await seedOrganization("main-fk-ok");
    const own = await seedProject(organizationId);
    const staging = await seedEnvironment(own.projectId, `staging-${uniq()}`);
    expect(await pointerRefusal(own.projectId, staging)).toEqual({ code: null, constraint: null });
    expect(await pointerRefusal(own.projectId, null)).toEqual({ code: null, constraint: null });
  });

  test("deleting the main environment, then the project, still works", async () => {
    const organizationId = await seedOrganization("main-fk-del");
    const own = await seedProject(organizationId);
    const deletedMain = await deleteEnv({ id: own.mainEnvironmentId, organizationId });
    expect(deletedMain.isOk()).toBe(true);
    const [row] = await db
      .select({ environmentId: project.environmentId })
      .from(project)
      .where(eq(project.id, own.projectId));
    expect(row?.environmentId).toBeNull();

    // Both rows go in one statement: the project, and (cascading) its main
    // environment, which the project's own pointer still names.
    const other = await seedProject(organizationId);
    await db.delete(project).where(eq(project.id, other.projectId));
    expect(await environmentRow(other.mainEnvironmentId)).toBeUndefined();
  });
});
