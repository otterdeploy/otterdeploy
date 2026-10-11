import { db } from "@otterdeploy/db";
import { preview, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { createId } from "@otterdeploy/shared/id";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vite-plus/test";

import { type FakeDockerDaemon, startFakeDockerDaemon } from "../../__tests__/fake-docker-daemon";
import {
  seedDatabase,
  seedEnvironment,
  seedGitRepo,
  seedOrganization,
  seedProject,
  seedService,
} from "../../__tests__/postgres-seed";
import { resolveRuntimeScope } from "../../lib/environment/runtime-scope";
import { networkScopeSuffix } from "../../lib/environment/scoping";
import { upsertServiceEnvVar } from "../../routers/service/queries/env";
import { ensurePreviewDatabaseAccess } from "../preview-network-access";

const socket = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-preview-access-${process.pid}.sock`;
  // oxlint-disable-next-line node/no-process-env -- test daemon boundary
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});
let daemon: FakeDockerDaemon;
beforeAll(() => {
  daemon = startFakeDockerDaemon(socket);
});
afterAll(() => daemon.stop());
it("grants only referenced main databases, then revokes the base when a branch exists", async () => {
  const org = await seedOrganization("preview-network");
  const p = await seedProject(org);
  const envId = await seedEnvironment(p.projectId, "staging");
  const repoId = await seedGitRepo(org, "owner/access-proof");
  const main = await seedDatabase({
    projectId: p.projectId,
    environmentId: p.mainEnvironmentId,
    name: "pg",
    tag: "main",
  });
  const stage = await seedDatabase({
    projectId: p.projectId,
    environmentId: envId,
    name: "pg",
    tag: "staging",
  });
  const svc = await seedService({
    projectId: p.projectId,
    environmentId: p.mainEnvironmentId,
    name: "web",
  });
  await db
    .update(serviceResource)
    .set({ source: "git", gitRepoId: repoId, previewsEnabled: true })
    .where(eq(serviceResource.resourceId, svc.resourceId));
  await upsertServiceEnvVar({
    serviceResourceId: svc.resourceId,
    key: "DATABASE_URL",
    value: "${{pg.DATABASE_URL}}",
  });
  const [pr] = await db
    .insert(preview)
    .values({
      projectId: p.projectId,
      gitRepoId: repoId,
      prNumber: 7,
      slug: "access-pr-7",
      branch: "feature",
      headSha: "abc",
    })
    .returning();
  if (!pr) throw new Error("missing preview");
  const network = `otterdeploy-${p.slug}.${networkScopeSuffix(pr).slice(1)}`;
  daemon.state.networks.add(network);
  const mainContainer = daemon.addContainer({
    name: "actual-shared-host",
    labels: { "otterdeploy.resource.id": main.resourceId },
  });
  const stageContainer = daemon.addContainer({
    name: "staging",
    labels: { "otterdeploy.resource.id": stage.resourceId },
  });
  await ensurePreviewDatabaseAccess(pr.id);
  expect(mainContainer.networks[network]?.aliases).toContain(main.host);
  expect(stageContainer.networks[network]).toBeUndefined();
  await db
    .insert(resource)
    .values({ projectId: p.projectId, previewId: pr.id, name: "pg", type: "database" });
  await ensurePreviewDatabaseAccess(pr.id);
  expect(mainContainer.networks[network]).toBeUndefined();
});
it("missing previews fail closed in deploy scope and shared database access", async () => {
  const missing = createId("prev");
  await expect(ensurePreviewDatabaseAccess(missing)).rejects.toThrow("no longer exists");
  await expect(
    resolveRuntimeScope({ projectId: createId("prj"), environmentId: null, previewId: missing }),
  ).rejects.toThrow("no longer exists");
});
