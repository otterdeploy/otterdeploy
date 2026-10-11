/**
 * Against a migrated Postgres: a git service that apply created but never
 * built is picked up by the next apply.
 *
 * An apply cut short between creating a git service and enqueueing its build
 * left the service on its placeholder image. It then matched the manifest,
 * diffed as a no-op, and no later apply ever built it. The apply now builds a
 * git service it has no change for when that service has never recorded a
 * deployment. One whose build started (and maybe failed) is left alone.
 */
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/project";
import { describe, expect, it } from "vite-plus/test";

import type { ApplyContext } from "../manifest-apply-phases";

import { seedGitRepo, seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { manifestSchema } from "../../../stack/manifest/schema";
import { createServiceRecord } from "../../service/queries/service";
import { unbuiltGitServices } from "../manifest-apply-phases-services";

const log: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

async function seed() {
  const organizationId = await seedOrganization("unbuilt");
  const project = await seedProject(organizationId);
  const gitRepoId = await seedGitRepo(organizationId, `acme/web-${uniq()}`);
  const service = async (name: string, over: { image: string; git: boolean }) =>
    (
      await createServiceRecord({
        projectId: project.projectId,
        environmentId: project.mainEnvironmentId,
        name,
        image: over.image,
        source: over.git ? "git" : "image",
        gitRepoId: over.git ? gitRepoId : null,
        internalHostname: `${name}-${uniq()}`,
        serviceName: `od-${name}-${uniq()}`,
        networkName: `net-${uniq()}`,
        ports: [],
      })
    ).resource.id;
  const ctx: ApplyContext = {
    projectId: project.projectId,
    environmentId: project.mainEnvironmentId,
    scope: { environmentId: project.mainEnvironmentId, isMain: true },
    organizationId,
    manifest: manifestSchema.parse({
      project: project.slug,
      services: {
        never: { source: "git", repo: "acme/web" },
        started: { source: "git", repo: "acme/web" },
        img: { source: "image", image: "nginx:alpine" },
      },
    }),
    current: { services: {}, databases: {}, composes: {} },
    sourceUploads: new Set(),
    actorUserId: null,
    log,
  };
  return { ctx, service };
}

describe("an apply with no change for a git service", () => {
  it("builds one that was created and never built, and only that one", async () => {
    const { ctx, service } = await seed();
    const never = await service("never", { image: "pending:initial", git: true });
    const started = await service("started", { image: "pending:initial", git: true });
    await service("img", { image: "nginx:alpine", git: false });
    // A build that started and failed: the operator's to retry, not apply's.
    await db
      .insert(deployment)
      .values({ resourceId: started, image: "pending:abc", reason: "create", status: "failed" });

    const builds = await unbuiltGitServices(ctx, ["never", "started", "img"]);
    expect(builds).toEqual([{ resourceId: never, name: "never" }]);
  });
});
