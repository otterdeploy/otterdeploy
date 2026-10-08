/**
 * The upgrade path of migration 20261007184825_resource_environment_in_project,
 * which adds a composite foreign key so a resource's environment must exist
 * AND belong to the resource's own project.
 *
 * An existing install can already hold rows that break that rule ("stranded":
 * invisible to every scoped read, since nothing matched their environment).
 * The migration repairs them before adding the constraint, without deleting or
 * renaming anything: each stranded (project, environment id) pair gets a
 * "Recovered environment" in that project, reusing the lost id when it is free.
 * These cases seed a database at the revision just before the migration and
 * apply it on top, driving drizzle's migrator directly like
 * project-slug-migration.postgres.test.ts.
 */

import type { SQL } from "bun";

import { afterEach, describe, expect, test } from "vite-plus/test";
import * as z from "zod";

import {
  applyMigrations,
  type Cleanups,
  installBefore,
  MIGRATIONS_DIR,
  short,
} from "../../../__tests__/postgres-migrations";

const MIGRATION = "20261007184825_resource_environment_in_project";

const resourceRows = z.tuple([
  z.object({ name: z.string(), environment_id: z.string().nullable() }),
]);
const environmentRows = z.array(
  z.object({
    id: z.string(),
    project_id: z.string().nullable(),
    name: z.string(),
    slug: z.string(),
    protected: z.boolean(),
  }),
);

describe("resource environment FK migration on an existing install", () => {
  const cleanups: Cleanups = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** A database migrated up to just before the FK migration. */
  const legacyInstall = () => installBefore(MIGRATION, cleanups);

  /** An org + project + its main environment, the shape project.create leaves. */
  async function seedProject(sql: SQL): Promise<{ projectId: string; mainId: string }> {
    const org = `org_${short()}`;
    await sql`insert into "organization" (id, name, slug, created_at) values (${org}, ${org}, ${org}, now())`;
    const projectId = `prj_${short()}`;
    const mainId = `env_${short()}`;
    const slug = `p-${short()}`;
    await sql`insert into "project" (id, organization_id, name, slug, environment_id) values (${projectId}, ${org}, ${slug}, ${slug}, ${mainId})`;
    await sql`insert into "environment" (id, project_id, name, slug) values (${mainId}, ${projectId}, 'production', 'production')`;
    return { projectId, mainId };
  }

  async function seedResource(
    sql: SQL,
    projectId: string,
    environmentId: string | null,
    name: string,
  ): Promise<string> {
    const id = `res_${short()}`;
    await sql`insert into "resource" (id, project_id, name, type, environment_id) values (${id}, ${projectId}, ${name}, 'service', ${environmentId})`;
    return id;
  }

  const readResource = async (sql: SQL, id: string) => {
    const rows: unknown = await sql`select name, environment_id from "resource" where id = ${id}`;
    return resourceRows.parse(rows)[0];
  };

  const readEnvironments = async (sql: SQL, projectId: string) => {
    const rows: unknown =
      await sql`select id, project_id, name, slug, protected from "environment" where project_id = ${projectId} order by name`;
    return environmentRows.parse(rows);
  };

  test("gives every stranded resource a recovered environment in its own project, touching nothing else", async () => {
    const { sql, url } = await legacyInstall();

    // 1. An environment deleted out from under its resources.
    const deleted = await seedProject(sql);
    const goneId = `env_${short()}`;
    const orphan = await seedResource(sql, deleted.projectId, goneId, "api");

    // 2. A resource stamped with ANOTHER project's environment.
    const borrower = await seedProject(sql);
    const lender = await seedProject(sql);
    const lenderStaging = `env_${short()}`;
    await sql`insert into "environment" (id, project_id, name, slug) values (${lenderStaging}, ${lender.projectId}, 'staging', 'staging')`;
    const misfiled = await seedResource(sql, borrower.projectId, lenderStaging, "worker");

    // 3. A project whose MAIN environment row is gone, with a main resource.
    const headless = await seedProject(sql);
    await sql`delete from "environment" where id = ${headless.mainId}`;
    const mainResource = await seedResource(sql, headless.projectId, headless.mainId, "web");

    // 4. Healthy rows: stamped with their own environment, and unstamped.
    const healthy = await seedProject(sql);
    const stamped = await seedResource(sql, healthy.projectId, healthy.mainId, "db");
    const unstamped = await seedResource(sql, healthy.projectId, null, "cache");

    await applyMigrations(url, MIGRATIONS_DIR);

    // 1. Recreated under the lost id: the row itself is unchanged.
    expect(await readResource(sql, orphan)).toEqual({ name: "api", environment_id: goneId });
    const recovered = (await readEnvironments(sql, deleted.projectId)).find((e) => e.id === goneId);
    expect(recovered).toMatchObject({ name: "Recovered environment", protected: false });
    expect(recovered?.slug).toMatch(/^recovered-[0-9a-f]{12}$/);

    // 2. Moved into a fresh environment of its OWN project; the lender's
    //    environment is someone else's and is left exactly as it was.
    const moved = await readResource(sql, misfiled);
    expect(moved.name).toBe("worker");
    expect(moved.environment_id).not.toBe(lenderStaging);
    const borrowerEnvs = await readEnvironments(sql, borrower.projectId);
    expect(borrowerEnvs.find((e) => e.id === moved.environment_id)?.name).toBe(
      "Recovered environment",
    );
    expect((await readEnvironments(sql, lender.projectId)).map((e) => e.id).sort()).toEqual(
      [lender.mainId, lenderStaging].sort(),
    );

    // 3. Main is whole again, under the id the project still points at, so
    //    its containers keep rendering as base.
    expect(await readResource(sql, mainResource)).toEqual({
      name: "web",
      environment_id: headless.mainId,
    });
    expect((await readEnvironments(sql, headless.projectId)).map((e) => e.id)).toEqual([
      headless.mainId,
    ]);

    // 4. Nothing recovered where nothing was stranded.
    expect(await readResource(sql, stamped)).toEqual({
      name: "db",
      environment_id: healthy.mainId,
    });
    expect(await readResource(sql, unstamped)).toEqual({ name: "cache", environment_id: null });
    expect((await readEnvironments(sql, healthy.projectId)).map((e) => e.id)).toEqual([
      healthy.mainId,
    ]);

    // And from here on the database itself refuses a stranded row.
    const refused = await seedResource(sql, healthy.projectId, lenderStaging, "x").then(
      () => "inserted",
      () => "refused",
    );
    expect(refused).toBe("refused");
  }, 90_000);

  test("resources of two projects carrying the same lost id each land in an environment of their own project", async () => {
    const { sql, url } = await legacyInstall();

    // Both projects' resources were stamped with one environment id that no
    // longer exists. Recreating it for both would collide on the primary key
    // and abort the upgrade.
    const first = await seedProject(sql);
    const second = await seedProject(sql);
    const lostId = `env_${short()}`;
    const firstRow = await seedResource(sql, first.projectId, lostId, "api");
    const secondRow = await seedResource(sql, second.projectId, lostId, "api");

    await applyMigrations(url, MIGRATIONS_DIR);

    const rows = [await readResource(sql, firstRow), await readResource(sql, secondRow)];
    const kept = rows.filter((row) => row.environment_id === lostId);
    expect(kept).toHaveLength(1);
    const owner = rows[0]?.environment_id === lostId ? first : second;
    const other = owner === first ? second : first;
    const movedId = (owner === first ? rows[1] : rows[0])?.environment_id;

    // The lost id is back, in exactly one of the two projects.
    expect(
      (await readEnvironments(sql, owner.projectId)).find((e) => e.id === lostId),
    ).toMatchObject({ name: "Recovered environment" });
    // The other project's row moved into a fresh environment of its own.
    expect(movedId).not.toBe(lostId);
    expect((await readEnvironments(sql, other.projectId)).find((e) => e.id === movedId)?.name).toBe(
      "Recovered environment",
    );
    for (const row of rows) expect(row.name).toBe("api");
  }, 90_000);
});
