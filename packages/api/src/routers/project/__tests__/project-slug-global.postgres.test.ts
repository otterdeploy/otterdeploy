/**
 * Project slugs are GLOBALLY unique.
 *
 * The slug is not just a URL segment: it names the project's runtime objects
 * on the shared swarm. A service is `od-<projectSlug>-<name>`
 * (routers/service/inputs.ts deriveServiceNames, and the clone path in
 * routers/project/clone/execute.ts), the overlay network is
 * `<networkPrefix><projectSlug>` (swarm/network-name.ts), and volumes follow.
 * None of those carry the organization, so two organizations must never
 * share a project slug. The database enforces it install-wide
 * (`project_slug_unique` on slug alone, migration
 * 20261006191815_global_project_slugs) and `createProject` checks every org, so both cross-org cases are refused with a typed
 * ProjectConflictError that carries a free `suggestedSlug`.
 *
 * Drives the real create/rename paths against a migrated Postgres.
 */
import { describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { createProject, updateProject } from "../projects";
import { isProjectSlugTaken } from "../queries";

// The real lookup, wrapped so one test can model a concurrent create that
// lands between the pre-check and the insert.
vi.mock("../queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../queries")>();
  return { ...actual, isProjectSlugTaken: vi.fn(actual.isProjectSlugTaken) };
});

describe("a project slug belongs to one organization install-wide", () => {
  it("a project slug used by another org is rejected", async () => {
    const orgA = await seedOrganization("slug-owner");
    const orgB = await seedOrganization("slug-claimant");
    const { slug } = await seedProject(orgA, `shop-${uniq()}`);

    const second = await createProject({ organizationId: orgB, name: "Shop", slug });

    expect(second.isErr()).toBe(true);
    if (second.isErr()) {
      expect(second.error._tag).toBe("ProjectConflictError");
      // The suggestion is free install-wide, so taking it succeeds.
      expect(second.error.suggestedSlug).toBe(`${slug}-2`);
      const retry = await createProject({
        organizationId: orgB,
        name: "Shop",
        slug: second.error.suggestedSlug,
      });
      expect(retry.isOk()).toBe(true);
    }
  });

  it("renaming a project to a slug another org already uses is rejected", async () => {
    const orgA = await seedOrganization("slug-owner");
    const orgB = await seedOrganization("slug-renamer");
    const { slug: taken } = await seedProject(orgA, `shop-${uniq()}`);
    const own = await seedProject(orgB, `mine-${uniq()}`);

    const renamed = await updateProject({
      id: own.projectId,
      organizationId: orgB,
      slug: taken,
    });

    expect(renamed.isErr()).toBe(true);
    if (renamed.isErr()) expect(renamed.error._tag).toBe("ProjectConflictError");
  });

  // The pre-check passed (another org's create landed between it and the
  // insert), so `project_slug_unique` is what refuses the second project.
  it("a create racing past the slug pre-check is refused by the unique index", async () => {
    const orgA = await seedOrganization("slug-racer-a");
    const orgB = await seedOrganization("slug-racer-b");
    const { slug } = await seedProject(orgA, `race-${uniq()}`);
    vi.mocked(isProjectSlugTaken).mockResolvedValueOnce(false);

    const second = await createProject({ organizationId: orgB, name: "Race", slug });

    expect(isProjectSlugTaken).toHaveBeenLastCalledWith(slug);
    expect(second.isErr()).toBe(true);
    if (second.isErr()) {
      expect(second.error._tag).toBe("ProjectConflictError");
      expect(second.error.suggestedSlug).toBe(`${slug}-2`);
    }
  });

  // Control: proves the seeding and the conflict mapping work, so the two
  // cases above fail on the cross-org rule and nothing else.
  it("a project slug already used in the same org is rejected", async () => {
    const org = await seedOrganization("slug-same");
    const { slug } = await seedProject(org, `shop-${uniq()}`);

    const again = await createProject({ organizationId: org, name: "Shop", slug });

    expect(again.isErr()).toBe(true);
    if (again.isErr()) expect(again.error._tag).toBe("ProjectConflictError");
  });
});
