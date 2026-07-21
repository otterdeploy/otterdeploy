import { describe, expect, it } from "vite-plus/test";

import { buildServiceVolumeName, normalizeMountPath } from "../volume-name";

describe("normalizeMountPath", () => {
  it("ensures a leading slash and strips trailing/duplicate slashes", () => {
    expect(normalizeMountPath("/data")).toBe("/data");
    expect(normalizeMountPath("data")).toBe("/data");
    expect(normalizeMountPath("/data/")).toBe("/data");
    expect(normalizeMountPath("//var//lib//pg//")).toBe("/var/lib/pg");
  });

  it("maps the root and empty inputs to /", () => {
    expect(normalizeMountPath("/")).toBe("/");
    expect(normalizeMountPath("")).toBe("/");
    expect(normalizeMountPath("   ")).toBe("/");
  });
});

describe("buildServiceVolumeName", () => {
  it("is deterministic for the same (service, path)", () => {
    const a = buildServiceVolumeName({ serviceName: "waves", mountPath: "/data" });
    const b = buildServiceVolumeName({ serviceName: "waves", mountPath: "/data/" });
    expect(a).toBe(b); // path normalized first
  });

  it("produces a docker-name-safe string with the otterdeploy-vol prefix", () => {
    const name = buildServiceVolumeName({ serviceName: "My Service!", mountPath: "/var/lib/pg" });
    expect(name).toMatch(/^otterdeploy-vol-/);
    expect(name).toMatch(/^[a-z0-9][a-z0-9_.-]*$/);
  });

  it("gives distinct volumes to paths that slugify alike (hash disambiguates)", () => {
    const ab = buildServiceVolumeName({ serviceName: "svc", mountPath: "/a/b" });
    const adashb = buildServiceVolumeName({ serviceName: "svc", mountPath: "/a-b" });
    expect(ab).not.toBe(adashb);
  });

  it("gives distinct volumes to the same path on different services", () => {
    const one = buildServiceVolumeName({ serviceName: "svc-one", mountPath: "/data" });
    const two = buildServiceVolumeName({ serviceName: "svc-two", mountPath: "/data" });
    expect(one).not.toBe(two);
  });
});
