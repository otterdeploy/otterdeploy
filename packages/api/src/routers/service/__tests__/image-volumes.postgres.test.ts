/**
 * the builder backs each VOLUME the image declares with a
 * persistent `service_mount` row. Real Postgres, real mount queries: the
 * property that matters is in the write (idempotent across rebuilds, and an
 * operator's own mount at the path is never replaced).
 */
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService } from "../../../__tests__/postgres-seed";
import { backImageVolumes } from "../image-volumes";
import { listServiceMounts, upsertServiceMount } from "../queries/mounts";
import { buildServiceVolumeName } from "../volume-name";

async function seed() {
  const organizationId = await seedOrganization("image-volumes");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const svc = await seedService({ projectId, environmentId: mainEnvironmentId, name: "gitea" });
  // seedService names the swarm service after the internal host.
  return { ...svc, serviceName: `od-${svc.host}`.slice(0, 63) };
}

describe("backImageVolumes", () => {
  it("attaches a named volume per declared path, and a rebuild reuses it", async () => {
    const svc = await seed();
    const first = await backImageVolumes({
      serviceResourceId: svc.resourceId,
      serviceName: svc.serviceName,
      declared: ["/data", "/config"],
    });
    expect(first.map((b) => [b.path, b.kind])).toEqual([
      ["/config", "created"],
      ["/data", "created"],
    ]);

    const rows = await listServiceMounts(svc.resourceId);
    const byTarget = new Map(rows.map((r) => [r.target, r]));
    for (const path of ["/data", "/config"]) {
      expect(byTarget.get(path)?.type).toBe("volume");
      expect(byTarget.get(path)?.source).toBe(
        buildServiceVolumeName({ serviceName: svc.serviceName, mountPath: path }),
      );
    }

    // The next build of the same image finds the volumes it made and keeps
    // them: same names, no new rows.
    const again = await backImageVolumes({
      serviceResourceId: svc.resourceId,
      serviceName: svc.serviceName,
      declared: ["/data", "/config"],
    });
    expect(again.map((b) => b.kind)).toEqual(["attached", "attached"]);
    expect(await listServiceMounts(svc.resourceId)).toHaveLength(2);
  });

  it("keeps the volume the operator attached at a declared path", async () => {
    const svc = await seed();
    await upsertServiceMount({
      serviceResourceId: svc.resourceId,
      type: "volume",
      target: "/data",
      source: "operator-chosen",
      content: null,
    });
    const plan = await backImageVolumes({
      serviceResourceId: svc.resourceId,
      serviceName: svc.serviceName,
      declared: ["/data"],
    });
    expect(plan).toEqual([
      { path: "/data", kind: "attached", mountType: "volume", source: "operator-chosen" },
    ]);
    const rows = await listServiceMounts(svc.resourceId);
    expect(rows.map((r) => r.source)).toEqual(["operator-chosen"]);
  });

  it("writes nothing for an image that declares no VOLUME", async () => {
    const svc = await seed();
    expect(
      await backImageVolumes({
        serviceResourceId: svc.resourceId,
        serviceName: svc.serviceName,
        declared: [],
      }),
    ).toEqual([]);
    expect(await listServiceMounts(svc.resourceId)).toHaveLength(0);
  });
});
