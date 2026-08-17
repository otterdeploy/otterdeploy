import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { ProjectStreamEvent } from "../project/events-stream";

import { toCollectionEvents } from ".";

const scope = {
  organizationId: idSchema.organization.parse("org_test"),
  projectId: idSchema.project.parse("prj_test"),
};

const routeId = idSchema.proxyRoute.parse("rt_test");
const resourceId = idSchema.resource.parse("res_test");

describe("toCollectionEvents", () => {
  it("converts route removals to collection deletes", () => {
    const event: ProjectStreamEvent = {
      kind: "route",
      action: "removed",
      routeId,
      resourceId,
    };

    expect(toCollectionEvents(event, scope)).toEqual([
      {
        protocol: 1,
        collection: "proxy-routes",
        scope: { ...scope, resourceId: "res_test" },
        op: "delete",
        keys: ["rt_test"],
      },
    ]);
  });

  it("turns runtime changes into scoped collection resyncs", () => {
    const event: ProjectStreamEvent = {
      kind: "task",
      action: "update",
      resourceId,
      taskId: "task_test",
      state: "running",
    };

    expect(toCollectionEvents(event, scope).map((item) => item.collection)).toEqual([
      "resources",
      "deployments",
      "deployment-tasks",
      "service-tasks",
    ]);
    expect(toCollectionEvents(event, scope).every((item) => item.op === "resync")).toBe(true);
  });

  it("maps write announcements to a single resync of exactly that collection", () => {
    const manifest: ProjectStreamEvent = { kind: "manifest", action: "changed" };
    const previews: ProjectStreamEvent = { kind: "previews", action: "changed" };

    expect(toCollectionEvents(manifest, scope)).toEqual([
      { protocol: 1, collection: "manifest", scope, op: "resync" },
    ]);
    expect(toCollectionEvents(previews, scope)).toEqual([
      { protocol: 1, collection: "previews", scope, op: "resync" },
    ]);
  });

  it("also resyncs dependencies when resource membership changes", () => {
    const event: ProjectStreamEvent = {
      kind: "resource",
      action: "removed",
      resourceId,
    };

    expect(toCollectionEvents(event, scope).at(-1)).toMatchObject({
      collection: "dependencies",
      op: "resync",
    });
  });
});
