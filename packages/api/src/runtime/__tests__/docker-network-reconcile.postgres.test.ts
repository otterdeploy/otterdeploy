import { db } from "@otterdeploy/db";
import { preview, serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vite-plus/test";

import { type FakeDockerDaemon, startFakeDockerDaemon } from "../../__tests__/fake-docker-daemon";
import {
  seedEnvironment,
  seedGitRepo,
  seedOrganization,
  seedProject,
  seedService,
} from "../../__tests__/postgres-seed";
import { resolveRuntimeScope } from "../../lib/environment/runtime-scope";
import { networkScopeSuffix } from "../../lib/environment/scoping";
import { reconcileDockerNetworks } from "../docker-network-reconcile";

const socket = vi.hoisted(() => {
  const path = `/tmp/otterdeploy-migrate-net-${process.pid}.sock`;
  // oxlint-disable-next-line node/no-process-env -- test daemon boundary
  process.env.DOCKER_HOST = `unix://${path}`;
  return path;
});
// Sharing is separately tested; this test exercises stored ownership + actual
// Docker transport for the migration, independent of preview DB references.
vi.mock("../preview-network-access", () => ({
  ensurePreviewDatabaseAccess: async () => undefined,
}));
let daemon: FakeDockerDaemon;
beforeAll(() => {
  daemon = startFakeDockerDaemon(socket);
});
afterAll(() => daemon.stop());

it("boot isolates staging and legacy previews without a redeploy, preserving main and aliases", async () => {
  const org = await seedOrganization("net-migration");
  const p = await seedProject(org);
  const stagingId = await seedEnvironment(p.projectId, "staging");
  const main = await seedService({
    projectId: p.projectId,
    environmentId: p.mainEnvironmentId,
    name: "web",
  });
  const staging = await seedService({
    projectId: p.projectId,
    environmentId: stagingId,
    name: "web",
  });
  const repoId = await seedGitRepo(org, "owner/network-proof");
  await db
    .update(serviceResource)
    .set({ gitRepoId: repoId })
    .where(eq(serviceResource.resourceId, main.resourceId));
  const [pr] = await db
    .insert(preview)
    .values({
      projectId: p.projectId,
      gitRepoId: repoId,
      prNumber: 7,
      slug: "repo-pr-7",
      branch: "feature",
      headSha: "abc",
    })
    .returning();
  if (!pr) throw new Error("missing preview");
  const legacy = `otterdeploy-${p.slug}`;
  const stageNet = `${legacy}.staging`;
  const previewNet = `${legacy}.${networkScopeSuffix(pr).slice(1)}`;
  daemon.state.networks = new Set([legacy, stageNet, previewNet]);
  const add = (name: string, resourceId: string) =>
    daemon.addContainer({
      name,
      labels: { "otterdeploy.managed": "true", "otterdeploy.resource.id": resourceId },
      networks: { [legacy]: { aliases: [name, "stable.internal"] } },
    });
  const prod = add(main.serviceName, main.resourceId);
  const stage = add(`${staging.serviceName}-staging`, staging.resourceId);
  // Older container with no deployment label: exact name + repo ownership.
  const previewContainer = add(`${main.serviceName}-pr-7`, main.resourceId);
  await reconcileDockerNetworks();
  expect(Object.keys(prod.networks)).toEqual([legacy]);
  expect(Object.keys(stage.networks)).toEqual([stageNet]);
  expect(Object.keys(previewContainer.networks)).toEqual([previewNet]);
  expect(stage.networks[stageNet]?.aliases).toContain("stable.internal");
  await reconcileDockerNetworks();
  expect(Object.keys(stage.networks)).toEqual([stageNet]);
  const scope = await resolveRuntimeScope({
    projectId: p.projectId,
    environmentId: null,
    previewId: pr.id,
  });
  expect(networkScopeSuffix(scope)).toBe(networkScopeSuffix(pr));
});

it("a daemon listing failure prevents a successful migration claim", async () => {
  daemon.state.failing.add("GET /containers/json");
  try {
    await expect(reconcileDockerNetworks()).rejects.toThrow();
  } finally {
    daemon.state.failing.clear();
  }
});
