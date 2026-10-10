/**
 * The Coolify import against a migrated Postgres.
 *
 *  - An app Coolify builds from a public https git URL imported
 *    with no repository on an install with no GitHub App, and failed its
 *    first deploy. The import now binds the clone URL as a public repo.
 *  - Re-running the import created a `-2` copy of every project
 *    (with its services and domains). The imported project now records its
 *    Coolify source, and a re-run reports it instead of copying it.
 *
 * Builds are not started here: enqueueing one resolves the repo head over the
 * network, which is the builder's business, not the import's.
 */
import { db } from "@otterdeploy/db";
import { gitRepo, project, resource, serviceResource } from "@otterdeploy/db/schema";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { describe, expect, it, vi } from "vite-plus/test";

import type { CoolifyPlan, PlannedService } from "../coolify";

import { seedOrganization, uniq } from "../../../__tests__/postgres-seed";
import { applyCoolifyPlan } from "../apply";

vi.mock("../../project/manifest-apply-git", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../project/manifest-apply-git")>();
  return {
    ...original,
    enqueueGitBuild: async () => Result.err("builds are not started in this test"),
  };
});

// Binding a public repo asks the remote for its default branch; no network
// here, so the column default stands.
vi.mock("../../../git/remote-default-branch", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../git/remote-default-branch")>();
  return { ...original, resolveRemoteDefaultBranch: async () => null };
});

const log = () => createRequestLogger({ method: "TEST", path: "/migrate/coolify/apply" });

function service(overrides: Partial<PlannedService>): PlannedService {
  return {
    name: "storefront",
    repo: null,
    cloneUrl: null,
    branch: "master",
    buildPack: "dockerfile",
    dockerfilePath: "/Dockerfile",
    sourceSubdir: null,
    port: 80,
    domains: [],
    env: [],
    warnings: [],
    ...overrides,
  };
}

function planOf(name: string, services: PlannedService[]): CoolifyPlan {
  return {
    version: "4.0.0",
    warnings: [],
    projects: [{ name, sourceId: `uuid-${name}`, services, databases: [] }],
  };
}

async function projectsNamed(organizationId: string, name: string) {
  return db
    .select({ id: project.id, slug: project.slug })
    .from(project)
    .where(eq(project.organizationId, idSchema.organization.parse(organizationId)))
    .then((rows) => rows.filter((row) => row.slug.startsWith(name)));
}

describe("Coolify import", () => {
  it("re-running the import is a no-op: no -2 copy of the project", async () => {
    const organizationId = await seedOrganization("coolify-rerun");
    const name = `legacy-shop-${uniq()}`.toLowerCase();
    const plan = planOf(name, [service({})]);

    const first = await applyCoolifyPlan({ plan, organizationId, log: log() });
    expect(first.projects[0]?.error).toBeNull();
    const firstSlug = first.projects[0]?.slug;
    expect(firstSlug).toBe(name);

    const second = await applyCoolifyPlan({ plan, organizationId, log: log() });
    expect(second.projects[0]?.error).toBeNull();
    expect(second.projects[0]?.slug).toBe(firstSlug);
    expect(await projectsNamed(organizationId, name)).toHaveLength(1);
  });

  it("a project of the same name created by hand is not mistaken for an import", async () => {
    const organizationId = await seedOrganization("coolify-samename");
    const name = `shop-${uniq()}`.toLowerCase();
    // Imported once under one Coolify source...
    await applyCoolifyPlan({ plan: planOf(name, [service({})]), organizationId, log: log() });
    // ...a different Coolify project with the same display name still imports.
    const other: CoolifyPlan = {
      ...planOf(name, [service({})]),
      projects: [{ name, sourceId: "another-uuid", services: [service({})], databases: [] }],
    };
    const result = await applyCoolifyPlan({ plan: other, organizationId, log: log() });
    expect(result.projects[0]?.slug).toBe(`${name}-2`);
    expect(await projectsNamed(organizationId, name)).toHaveLength(2);
  });

  it("an app built from a public https git URL imports bound to that repository", async () => {
    const organizationId = await seedOrganization("coolify-public");
    const name = `public-git-${uniq()}`.toLowerCase();
    const owner = `traefik${uniq()}`.toLowerCase();
    const cloneUrl = `https://github.com/${owner}/whoami.git`;
    const result = await applyCoolifyPlan({
      plan: planOf(name, [service({ repo: `${owner}/whoami`, cloneUrl })]),
      organizationId,
      log: log(),
    });
    expect(result.projects[0]?.error).toBeNull();

    const [bound] = await db
      .select({ cloneUrl: gitRepo.cloneUrl, installationId: gitRepo.installationId })
      .from(serviceResource)
      .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
      .innerJoin(project, eq(project.id, resource.projectId))
      .innerJoin(gitRepo, eq(gitRepo.id, serviceResource.gitRepoId))
      .where(eq(project.slug, name));
    expect(bound).toEqual({ cloneUrl, installationId: null });
  });
});
