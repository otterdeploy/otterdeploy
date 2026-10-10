import { describe, expect, test } from "vite-plus/test";

import { containerOwner } from "../container-owner";

describe("containerOwner", () => {
  test("a deployed resource names its project and resource", () => {
    expect(
      containerOwner({
        "otterdeploy.managed": "true",
        "otterdeploy.project": "toolbox",
        "otterdeploy.resource.id": "res_1",
        "otterdeploy.resource.type": "service",
      }),
    ).toEqual({ kind: "resource", projectSlug: "toolbox", projectId: null, resourceId: "res_1" });
  });

  test("a compose stack member carries its project id instead of a slug", () => {
    expect(
      containerOwner({
        "otterdeploy.kind": "compose",
        "otterdeploy.resource.id": "res_2",
        "otterdeploy.project.id": "prj_9",
      }),
    ).toEqual({ kind: "resource", projectSlug: null, projectId: "prj_9", resourceId: "res_2" });
  });

  test("the install's own containers are platform, with their role when stamped", () => {
    expect(containerOwner({ "com.docker.compose.project": "otterdeploy" })).toEqual({
      kind: "platform",
      role: null,
    });
    expect(
      containerOwner({ "otterdeploy.managed": "true", "otterdeploy.role": "health-agent" }),
    ).toEqual({ kind: "platform", role: "health-agent" });
  });

  test("anything else is unmanaged", () => {
    expect(containerOwner({ "com.docker.compose.project": "kaitosec" })).toEqual({
      kind: "unmanaged",
    });
    expect(containerOwner(undefined)).toEqual({ kind: "unmanaged" });
  });
});
