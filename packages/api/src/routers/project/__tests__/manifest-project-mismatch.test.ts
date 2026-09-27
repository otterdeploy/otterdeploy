/**
 * `saveManifest` refuses a manifest whose `project` slug names a different
 * project than the one being written to.
 *
 * Why this matters more than a stray field usually would: the slug is decorative
 * on the server but LOAD-BEARING in the CLI. `runDeploy` picks its target with
 *
 *     const project = await client.project.getBySlug({ slug: manifest.project });
 *
 * so the file's own `project` decides which project gets written. Nothing
 * compared it to the `projectId` the save was addressed to, which made this
 * sequence possible:
 *
 *   1. anything saves a manifest to project A carrying `project: "b"`;
 *   2. `otterdeploy pull` writes that manifest to disk, slug and all;
 *   3. the next `otterdeploy deploy` from that directory resolves project B;
 *   4. `save` REPLACES wholesale, so every resource B has that the payload
 *      omits is reported as removed — and applied as a deletion.
 *
 * The mismatch is free to catch at the write and impossible to recover from
 * after step 4, so it is refused here.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it, vi } from "vite-plus/test";

const selectMock = vi.fn();
/** Held as its own binding rather than reached through `db.update`, which the
 *  unbound-method rule flags for detaching a method from its receiver. */
const updateMock = vi.fn();

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));

const { saveManifest } = await import("../manifest");
const { manifestSchema } = await import("../../../stack/manifest");

const projectId = idSchema.project.parse("prj_1");
const organizationId = idSchema.organization.parse("org_1");

/** The project row lookup `saveManifest` does before writing. */
function projectSlugIs(slug: string): void {
  selectMock.mockReturnValue({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([{ slug }]) }) }),
  });
}

function manifestFor(slug: string) {
  return manifestSchema.parse({ project: slug, services: {}, databases: {}, composes: {} });
}

describe("saveManifest, when the manifest names another project", () => {
  it("refuses rather than writing", async () => {
    projectSlugIs("project-a");

    const result = await saveManifest(
      { projectId, organizationId },
      { manifest: manifestFor("project-b"), expectedVersion: 0 },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("ManifestProjectMismatchError");
  });

  it("names both slugs, so the operator can see which way round it is", async () => {
    projectSlugIs("project-a");

    const result = await saveManifest(
      { projectId, organizationId },
      { manifest: manifestFor("project-b"), expectedVersion: 0 },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    const error = result.error;
    // Narrow by tag: `saveManifest` can also fail as not-found or a version
    // conflict, and neither of those carries the two slugs.
    if (error._tag !== "ManifestProjectMismatchError") throw new Error(`got ${error._tag}`);
    expect(error.expected).toBe("project-a");
    expect(error.received).toBe("project-b");
    expect(error.message).toContain("project-a");
    expect(error.message).toContain("project-b");
  });

  it("checks the slug BEFORE the update, so a mismatch cannot bump the version", async () => {
    projectSlugIs("project-a");
    updateMock.mockClear();

    await saveManifest(
      { projectId, organizationId },
      { manifest: manifestFor("project-b"), expectedVersion: 0 },
    );

    // The optimistic-lock bump is a write. Reaching it on a mismatch would
    // invalidate every other session's expectedVersion for nothing.
    expect(updateMock).not.toHaveBeenCalled();
  });
});
