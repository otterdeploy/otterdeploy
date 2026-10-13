/**
 * The upgrade path for per-environment applied manifests.
 *
 * Before this, one snapshot per project was written by whichever environment
 * applied last. A project with a single environment can only have been
 * applied by that environment, so its snapshot is carried over. A project
 * with several cannot say which of them wrote it, and reading it as any one
 * environment's record is what made a resource another environment applied
 * look like a pending delete. Those start empty.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import {
  applyMigrations,
  installBefore,
  MIGRATIONS_DIR,
  short,
  type Cleanups,
} from "../../../__tests__/postgres-migrations";

const MIGRATION = "20261013092343_environment_applied_manifest";

const environmentRows = z.array(
  z.object({
    id: z.string(),
    applied_manifest: z.unknown(),
    applied_manifest_resolved: z.unknown(),
  }),
);

describe("environment applied manifest migration on an existing install", () => {
  const cleanups: Cleanups = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("carries a lone environment's snapshot over and leaves a shared one unread", async () => {
    const { sql, url } = await installBefore(MIGRATION, cleanups);
    const org = `org_${short()}`;
    await sql`insert into "organization" (id, name, slug, created_at) values (${org}, ${org}, ${org}, now())`;

    const snapshot = JSON.stringify({
      project: "x",
      services: {},
      databases: { cache: { engine: "redis" } },
      composes: {},
    });
    const projects = { single: `prj_${short()}`, shared: `prj_${short()}` };
    const envs = {
      single: `env_${short()}`,
      sharedMain: `env_${short()}`,
      sharedStaging: `env_${short()}`,
    };
    for (const id of Object.values(projects)) {
      await sql`
        insert into "project" (id, organization_id, name, slug, last_applied_manifest, created_at, updated_at)
        values (${id}, ${org}, ${id}, ${id}, (${snapshot}::text)::jsonb, now(), now())
      `;
    }
    await sql`
      insert into "environment" (id, project_id, name, slug, created_at, updated_at)
      values
        (${envs.single}, ${projects.single}, 'production', 'production', now(), now()),
        (${envs.sharedMain}, ${projects.shared}, 'production', 'production', now(), now()),
        (${envs.sharedStaging}, ${projects.shared}, 'staging', 'staging', now(), now())
    `;
    await sql`update "project" set environment_id = ${envs.single} where id = ${projects.single}`;
    await sql`update "project" set environment_id = ${envs.sharedMain} where id = ${projects.shared}`;

    await applyMigrations(url, MIGRATIONS_DIR);

    const rows = environmentRows.parse(
      await sql`select id, applied_manifest, applied_manifest_resolved from "environment"
                where project_id in (${projects.single}, ${projects.shared})`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(envs.single)?.applied_manifest).toMatchObject({
      databases: { cache: { engine: "redis" } },
    });
    expect(byId.get(envs.single)?.applied_manifest_resolved).toMatchObject({
      databases: { cache: { engine: "redis" } },
    });
    for (const id of [envs.sharedMain, envs.sharedStaging]) {
      expect(byId.get(id)?.applied_manifest).toBeNull();
      expect(byId.get(id)?.applied_manifest_resolved).toBeNull();
    }
  });
});
