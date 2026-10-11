/**
 * A manifest is only saved to the project its `project` field names.
 *
 * Nothing compared the two, and the CLI resolves its target FROM that field
 * (`getBySlug({ slug: manifest.project })`). A manifest saved to project A while
 * naming project B would be pulled to disk naming B, and the next `deploy` from
 * that directory would replace B's manifest wholesale, every resource it omits
 * staged as a deletion. The mismatch is refused at the write, where it is cheap.
 *
 * Renaming a project keeps its stored manifest in step, so the check never
 * refuses a manifest that merely predates a rename.
 *
 * Drives the real save and rename paths against a migrated Postgres.
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import { describe, expect, test } from "vite-plus/test";

import type { Manifest } from "../../../stack/manifest";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { loadManifest, saveManifest } from "../manifest";
import { updateProject } from "../projects";

function manifestNaming(slug: string): Manifest {
  return {
    project: zSlug(ID_PREFIX.project).parse(slug),
    services: { web: { source: "image", image: "nginx" } },
    databases: {},
    composes: {},
  };
}

async function stored(scope: Parameters<typeof loadManifest>[0]) {
  const loaded = await loadManifest(scope);
  if (loaded.isErr()) throw loaded.error;
  return loaded.value;
}

describe("manifest.save checks the manifest names the project it is saved to", () => {
  test("a manifest naming another project is refused, and nothing is written", async () => {
    const organizationId = await seedOrganization("manifest-mismatch");
    const target = await seedProject(organizationId);
    const other = await seedProject(organizationId);
    const scope = { projectId: target.projectId, organizationId };
    const before = await stored(scope);

    const result = await saveManifest(scope, {
      manifest: manifestNaming(other.slug),
      expectedVersion: before.version,
    });

    expect(result.isErr() && result.error._tag).toBe("ManifestProjectMismatchError");
    expect(result.isErr() && result.error.message).toContain(other.slug);
    expect(result.isErr() && result.error.message).toContain(target.slug);
    expect(await stored(scope)).toEqual(before);
  });

  test("a manifest naming its own project saves", async () => {
    const organizationId = await seedOrganization("manifest-match");
    const target = await seedProject(organizationId);
    const scope = { projectId: target.projectId, organizationId };
    const before = await stored(scope);

    const result = await saveManifest(scope, {
      manifest: manifestNaming(target.slug),
      expectedVersion: before.version,
    });

    expect(result.isOk()).toBe(true);
    expect((await stored(scope)).manifest?.project).toBe(target.slug);
  });

  test("a stale version is still a version conflict, not a mismatch", async () => {
    const organizationId = await seedOrganization("manifest-stale");
    const target = await seedProject(organizationId);
    const scope = { projectId: target.projectId, organizationId };
    const before = await stored(scope);

    const result = await saveManifest(scope, {
      manifest: manifestNaming(target.slug),
      expectedVersion: before.version + 7,
    });

    expect(result.isErr() && result.error._tag).toBe("ManifestVersionConflictError");
  });

  test("renaming the project carries its stored manifest along", async () => {
    const organizationId = await seedOrganization("manifest-rename");
    const target = await seedProject(organizationId);
    const scope = { projectId: target.projectId, organizationId };
    const saved = await saveManifest(scope, {
      manifest: manifestNaming(target.slug),
      expectedVersion: (await stored(scope)).version,
    });
    expect(saved.isOk()).toBe(true);

    const renamedSlug = `renamed-${uniq()}`;
    const renamed = await updateProject({
      id: target.projectId,
      organizationId,
      slug: renamedSlug,
    });
    expect(renamed.isOk()).toBe(true);

    // What every server-side writer does: read the stored manifest, change it,
    // save it back. It must not be refused for naming the old slug.
    const current = await stored(scope);
    expect(current.manifest?.project).toBe(renamedSlug);
    if (!current.manifest) throw new Error("expected a stored manifest");
    const resaved = await saveManifest(scope, {
      manifest: { ...current.manifest, databases: {} },
      expectedVersion: current.version,
    });
    expect(resaved.isOk()).toBe(true);
  });
});
