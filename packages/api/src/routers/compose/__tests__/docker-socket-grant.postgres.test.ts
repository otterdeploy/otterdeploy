/**
 * Against a migrated Postgres: the docker socket reaches a stack's container
 * only while an install admin's grant sits on that stack's row.
 *
 * The case the reconcile-path tests cannot cover is the STORED mount. A stack
 * deployed before per-stack grants existed may already have a `service_mount`
 * row for the socket, and a child redeploy builds its spec from those rows,
 * not from the compose file. So this drives `buildSwarmSpec` on a real
 * child with a real socket row, ungranted, granted, then revoked.
 */
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { upsertServiceMount } from "../../service/queries";
import { getServiceRecord } from "../../service/queries/service";
import { buildSwarmSpec } from "../../service/spec";
import {
  createComposeRecord,
  getComposeRecord,
  loadStackHostBindGrants,
  setDockerSocketGrant,
} from "../queries";

const SOCKET = "/var/run/docker.sock";

async function seedStackChildWithStoredSocket() {
  const organizationId = await seedOrganization("sock");
  const { projectId, slug, mainEnvironmentId } = await seedProject(organizationId);
  const stack = await createComposeRecord({
    projectId,
    environmentId: mainEnvironmentId,
    name: `shell-${uniq()}`,
    source: "inline",
    composeContent: `services:\n  shell:\n    image: docker:cli\n`,
    stackName: `sock-${uniq()}`,
    services: [],
  });
  const stackId = stack.resource.id;
  const child = await seedService({
    projectId,
    environmentId: mainEnvironmentId,
    name: "shell",
    stackId,
    composeService: "shell",
  });
  // What a pre-fix reconcile wrote for `- /var/run/docker.sock:/var/run/docker.sock`.
  await upsertServiceMount({
    serviceResourceId: child.resourceId,
    type: "bind",
    target: SOCKET,
    source: SOCKET,
    content: null,
    readOnly: true,
  });
  await upsertServiceMount({
    serviceResourceId: child.resourceId,
    type: "volume",
    target: "/data",
    source: `shell-data-${uniq()}`,
    content: null,
  });
  return { projectId, slug, stackId, childId: child.resourceId };
}

async function specMountSources(
  projectId: Parameters<typeof getServiceRecord>[0],
  childId: Parameters<typeof getServiceRecord>[1],
  slug: string,
) {
  const record = await getServiceRecord(projectId, childId);
  if (!record) throw new Error("child service vanished");
  const spec = await buildSwarmSpec(record, {}, slug);
  return spec.mounts.map((m) => m.Target);
}

describe("the docker socket needs an install-admin grant on the stack row", () => {
  it("a new stack holds no grant", async () => {
    const { stackId, projectId } = await seedStackChildWithStoredSocket();
    expect(await loadStackHostBindGrants(stackId)).toEqual({ dockerSocket: false });
    const rec = await getComposeRecord(projectId, stackId);
    expect(rec?.compose.dockerSocketGrantedAt).toBeNull();
    expect(rec?.compose.dockerSocketGrantedBy).toBeNull();
  });

  it("a stored socket bind is not deployed for an ungranted stack", async () => {
    const { projectId, slug, childId } = await seedStackChildWithStoredSocket();
    expect(await specMountSources(projectId, childId, slug)).toEqual(["/data"]);
  });

  it("granted, the socket is deployed read-only; revoked, it is dropped again", async () => {
    const { projectId, slug, stackId, childId } = await seedStackChildWithStoredSocket();

    await setDockerSocketGrant({ resourceId: stackId, granted: true, userId: "usr_admin" });
    const granted = await getComposeRecord(projectId, stackId);
    expect(granted?.compose.dockerSocketGrantedAt).not.toBeNull();
    expect(granted?.compose.dockerSocketGrantedBy).toBe("usr_admin");
    expect((await specMountSources(projectId, childId, slug)).sort()).toEqual(["/data", SOCKET]);

    await setDockerSocketGrant({ resourceId: stackId, granted: false, userId: "usr_admin" });
    expect(await loadStackHostBindGrants(stackId)).toEqual({ dockerSocket: false });
    expect(await specMountSources(projectId, childId, slug)).toEqual(["/data"]);
  });

  it("a standalone service (no stack) never gets the socket", async () => {
    expect(await loadStackHostBindGrants(null)).toEqual({ dockerSocket: false });
  });
});
