/**
 * every path an image declares as VOLUME is backed by a
 * persistent volume for the service, or by the mount the operator already
 * attached there. Never two volumes for one path, never a second mount over
 * one the operator chose.
 */
import { describe, expect, it } from "vite-plus/test";

import { planImageVolumes } from "../image-volumes";
import { buildServiceVolumeName } from "../volume-name";

describe("planImageVolumes", () => {
  it("creates a deterministic named volume for an unbacked path", () => {
    const plan = planImageVolumes({
      serviceName: "otterdeploy-gitea-web",
      declared: ["/data"],
      existing: [],
    });
    expect(plan).toEqual([
      {
        path: "/data",
        kind: "created",
        volumeName: buildServiceVolumeName({
          serviceName: "otterdeploy-gitea-web",
          mountPath: "/data",
        }),
      },
    ]);
  });

  it("leaves a path the operator already mounted to their mount, whatever its type", () => {
    const plan = planImageVolumes({
      serviceName: "svc",
      declared: ["/data/", "/config"],
      existing: [
        { target: "/data", type: "volume", source: "mine" },
        { target: "/config", type: "bind", source: "/srv/config" },
      ],
    });
    expect(plan).toEqual([
      { path: "/config", kind: "attached", mountType: "bind", source: "/srv/config" },
      { path: "/data", kind: "attached", mountType: "volume", source: "mine" },
    ]);
  });

  it("collapses repeated and differently-spelled declarations to one volume", () => {
    const plan = planImageVolumes({
      serviceName: "svc",
      declared: ["/data", "/data/", "//data"],
      existing: [],
    });
    expect(plan).toHaveLength(1);
  });

  it("backs a nested path separately: a parent mount does not cover it", () => {
    const plan = planImageVolumes({
      serviceName: "svc",
      declared: ["/var/lib/app/data"],
      existing: [{ target: "/var/lib/app", type: "volume", source: "parent" }],
    });
    expect(plan[0]?.kind).toBe("created");
  });
});
