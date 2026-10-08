/**
 * The upgrade path of migration
 * 20261007195629_project_main_environment_in_project, which adds
 * `environment.claimable_by_organization_id` and a composite foreign key so a
 * project's main-environment pointer must name an environment of the project's
 * own.
 *
 * An existing install can already hold pointers that break that rule. The
 * migration repairs them before adding the constraint, deleting and renaming
 * nothing: a pointer at an environment that is gone gets it back under the
 * same id, and a pointer at someone else's environment moves to a fresh
 * "Recovered environment" of the project's own. Seeded at the revision before
 * the resource FK migration (20261007184825), so the two repairs run together
 * as they will on a real upgrade.
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

const SEED_BEFORE = "20261007184825_resource_environment_in_project";

const pointerRows = z.tuple([z.object({ environment_id: z.string().nullable() })]);
const environmentRows = z.array(
  z.object({
    id: z.string(),
    project_id: z.string().nullable(),
    name: z.string(),
    slug: z.string(),
    protected: z.boolean(),
    claimable_by_organization_id: z.string().nullable(),
  }),
);

describe("project main-environment FK migration on an existing install", () => {
  const cleanups: Cleanups = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** A database migrated up to just before the resource FK migration. */
  const legacyInstall = () => installBefore(SEED_BEFORE, cleanups);

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

  const pointTo = (sql: SQL, projectId: string, environmentId: string) =>
    sql`update "project" set environment_id = ${environmentId} where id = ${projectId}`;

  const readPointer = async (sql: SQL, projectId: string) => {
    const rows: unknown = await sql`select environment_id from "project" where id = ${projectId}`;
    return pointerRows.parse(rows)[0].environment_id;
  };

  const readEnvironments = async (sql: SQL, projectId: string) => {
    const rows: unknown =
      await sql`select id, project_id, name, slug, protected, claimable_by_organization_id from "environment" where project_id = ${projectId} order by name, id`;
    return environmentRows.parse(rows);
  };

  const readEnvironment = async (sql: SQL, id: string) => {
    const rows: unknown =
      await sql`select id, project_id, name, slug, protected, claimable_by_organization_id from "environment" where id = ${id}`;
    return environmentRows.parse(rows)[0];
  };

  test("repairs every dangling main pointer inside its own project, touching nothing else", async () => {
    const { sql, url } = await legacyInstall();

    // 1. The main environment row is gone; nothing else references it.
    const headless = await seedProject(sql);
    await sql`delete from "environment" where id = ${headless.mainId}`;

    // 2. Pointing at ANOTHER project's environment.
    const borrower = await seedProject(sql);
    const lender = await seedProject(sql);
    await pointTo(sql, borrower.projectId, lender.mainId);

    // 3. Pointing at a standalone (unclaimed) environment.
    const drifted = await seedProject(sql);
    const standalone = `env_${short()}`;
    await sql`insert into "environment" (id, project_id, name, slug) values (${standalone}, null, 'production', 'production')`;
    await pointTo(sql, drifted.projectId, standalone);

    // 4. Two projects pointing at the same lost id.
    const twinA = await seedProject(sql);
    const twinB = await seedProject(sql);
    const lostShared = `env_${short()}`;
    await pointTo(sql, twinA.projectId, lostShared);
    await pointTo(sql, twinB.projectId, lostShared);

    // 5. Pointing at another project's environment that the project's own
    //    resources were ALSO stamped with: the resource repair recovers that
    //    pair first, and the pointer must land in the same environment.
    const mixed = await seedProject(sql);
    const mixedLender = await seedProject(sql);
    await pointTo(sql, mixed.projectId, mixedLender.mainId);
    await sql`insert into "resource" (id, project_id, name, type, environment_id) values (${`res_${short()}`}, ${mixed.projectId}, 'api', 'service', ${mixedLender.mainId})`;

    // 6. Healthy, and a pointer cleared by env.delete.
    const healthy = await seedProject(sql);
    const cleared = await seedProject(sql);
    await sql`update "project" set environment_id = null where id = ${cleared.projectId}`;
    await sql`delete from "environment" where id = ${cleared.mainId}`;

    // 7. A standalone environment from before claim ownership existed.
    const orphanStandalone = `env_${short()}`;
    await sql`insert into "environment" (id, project_id, name, slug) values (${orphanStandalone}, null, 'staging', 'staging')`;

    await applyMigrations(url, MIGRATIONS_DIR);

    // 1. Recreated under the lost id: the pointer itself is unchanged.
    expect(await readPointer(sql, headless.projectId)).toBe(headless.mainId);
    const recovered = await readEnvironment(sql, headless.mainId);
    expect(recovered).toMatchObject({
      project_id: headless.projectId,
      name: "Recovered environment",
      protected: false,
    });
    expect(recovered?.slug).toMatch(/^recovered-[0-9a-f]{12}$/);

    // 2. Moved to a fresh environment of its OWN project; the lender keeps
    //    exactly what it had.
    const borrowed = await readPointer(sql, borrower.projectId);
    expect(borrowed).not.toBe(lender.mainId);
    expect(
      (await readEnvironments(sql, borrower.projectId)).find((e) => e.id === borrowed)?.name,
    ).toBe("Recovered environment");
    expect((await readEnvironments(sql, lender.projectId)).map((e) => e.id)).toEqual([
      lender.mainId,
    ]);
    expect(await readPointer(sql, lender.projectId)).toBe(lender.mainId);

    // 3. The standalone row is someone else's (or nobody's): left alone.
    const driftedTo = await readPointer(sql, drifted.projectId);
    expect(driftedTo).not.toBe(standalone);
    expect((await readEnvironments(sql, drifted.projectId)).some((e) => e.id === driftedTo)).toBe(
      true,
    );
    expect(await readEnvironment(sql, standalone)).toMatchObject({
      project_id: null,
      name: "production",
      claimable_by_organization_id: null,
    });

    // 4. One twin gets the lost id back, the other a fresh one; both valid.
    const twinPointers = [
      await readPointer(sql, twinA.projectId),
      await readPointer(sql, twinB.projectId),
    ];
    expect(twinPointers.filter((id) => id === lostShared)).toHaveLength(1);
    expect((await readEnvironment(sql, lostShared))?.project_id).toBe(
      twinPointers[0] === lostShared ? twinA.projectId : twinB.projectId,
    );

    // 5. Pointer and resource share the one recovered environment.
    const mixedEnvs = await readEnvironments(sql, mixed.projectId);
    const mixedRecovered = mixedEnvs.filter((e) => e.name === "Recovered environment");
    expect(mixedRecovered).toHaveLength(1);
    expect(await readPointer(sql, mixed.projectId)).toBe(mixedRecovered[0]?.id ?? null);

    // 6. Nothing recovered where nothing dangled; a NULL pointer stays NULL.
    expect(await readPointer(sql, healthy.projectId)).toBe(healthy.mainId);
    expect((await readEnvironments(sql, healthy.projectId)).map((e) => e.id)).toEqual([
      healthy.mainId,
    ]);
    expect(await readPointer(sql, cleared.projectId)).toBeNull();
    expect(await readEnvironments(sql, cleared.projectId)).toEqual([]);

    // 7. Kept, and claimable by no one.
    expect(await readEnvironment(sql, orphanStandalone)).toMatchObject({
      project_id: null,
      claimable_by_organization_id: null,
    });

    // From here on the database itself refuses a dangling pointer.
    const refused = await pointTo(sql, healthy.projectId, lender.mainId).then(
      () => "updated",
      () => "refused",
    );
    expect(refused).toBe("refused");
    expect(await readPointer(sql, healthy.projectId)).toBe(healthy.mainId);
  }, 90_000);
});
