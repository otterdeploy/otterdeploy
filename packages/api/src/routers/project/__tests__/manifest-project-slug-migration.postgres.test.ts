/**
 * The upgrade path for the manifest-names-its-project check.
 *
 * A save is refused unless the manifest's `project` matches the project's
 * slug. An existing install can hold stored manifests (and applied snapshots)
 * that name an older slug, left behind by a rename or by the global-slug
 * de-duplication. Without repairing them, every later read-modify-save of
 * those manifests would be refused. The migration rewrites each to its
 * project's current slug and leaves everything else as it was.
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

const MIGRATION = "20261011120000_manifest_project_follows_slug";

const manifestRows = z.array(
  z.object({
    id: z.string(),
    manifest: z.unknown(),
    last_applied_manifest: z.unknown(),
  }),
);

describe("manifest project slug migration on an existing install", () => {
  const cleanups: Cleanups = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("points every stored manifest at its project's current slug", async () => {
    const { sql, url } = await installBefore(MIGRATION, cleanups);
    const org = `org_${short()}`;
    await sql`insert into "organization" (id, name, slug, created_at) values (${org}, ${org}, ${org}, now())`;

    const stale = `prj_${short()}`;
    const current = `prj_${short()}`;
    const empty = `prj_${short()}`;
    const staleSlug = `renamed-${short()}`;
    const currentSlug = `current-${short()}`;
    const manifestNaming = (slug: string) =>
      JSON.stringify({ project: slug, services: { web: { source: "image", image: "nginx" } } });

    await sql`
      insert into "project" (id, organization_id, name, slug, manifest, last_applied_manifest, created_at, updated_at)
      values
        (${stale}, ${org}, 'stale', ${staleSlug}, (${manifestNaming("old-slug")}::text)::jsonb, (${manifestNaming("old-slug")}::text)::jsonb, now(), now()),
        (${current}, ${org}, 'current', ${currentSlug}, (${manifestNaming(currentSlug)}::text)::jsonb, null, now(), now()),
        (${empty}, ${org}, 'empty', ${`empty-${short()}`}, null, null, now(), now())
    `;

    await applyMigrations(url, MIGRATIONS_DIR);

    const rows = manifestRows.parse(
      await sql`select id, manifest, last_applied_manifest from "project" where organization_id = ${org}`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(stale)?.manifest).toEqual({
      project: staleSlug,
      services: { web: { source: "image", image: "nginx" } },
    });
    expect(byId.get(stale)?.last_applied_manifest).toMatchObject({ project: staleSlug });
    expect(byId.get(current)?.manifest).toMatchObject({ project: currentSlug });
    expect(byId.get(current)?.last_applied_manifest).toBeNull();
    expect(byId.get(empty)?.manifest).toBeNull();
  });
});
