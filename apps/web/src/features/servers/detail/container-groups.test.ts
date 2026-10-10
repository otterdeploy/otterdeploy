import { describe, expect, it } from "vite-plus/test";

import {
  containerHeadings,
  orderByOwner,
  type OwnedContainer,
  serviceHeadingView,
} from "./container-groups";

const resource = (
  name: string,
  project: string,
  service: string,
  id = service,
): OwnedContainer => ({
  name,
  owner: {
    kind: "resource",
    resourceId: `res_${id}`,
    resourceName: service,
    projectSlug: project,
    projectName: project,
    environmentSlug: "production",
  },
});
const orphan = (name: string, id: string): OwnedContainer => ({
  name,
  owner: {
    kind: "resource",
    resourceId: id,
    resourceName: null,
    projectSlug: "store",
    projectName: null,
    environmentSlug: null,
  },
});
const platform = (name: string): OwnedContainer => ({
  name,
  owner: { kind: "platform", role: null },
});
const stray = (name: string): OwnedContainer => ({ name, owner: { kind: "unmanaged" } });

const service = (id: string, name: string | null) => ({
  resourceId: `res_${id}`,
  resourceName: name,
  projectSlug: "toolbox",
  environmentSlug: "production",
});

describe("orderByOwner", () => {
  it("lists projects (by name, then service, then container), then Platform, then Unmanaged", () => {
    const ordered = orderByOwner([
      stray("redis-dev"),
      platform("otterdeploy-caddy"),
      resource("web-2", "toolbox", "web"),
      resource("pg-1", "billing", "postgres"),
      resource("web-1", "toolbox", "web"),
      resource("api-1", "toolbox", "api"),
      platform("otterdeploy-builder"),
    ]).map((c) => c.name);
    expect(ordered).toEqual([
      "pg-1",
      "api-1",
      "web-1",
      "web-2",
      "otterdeploy-builder",
      "otterdeploy-caddy",
      "redis-dev",
    ]);
  });

  it("puts a project's unresolved resources after its named ones", () => {
    const ordered = orderByOwner([
      orphan("old-1", "res_zzz"),
      resource("web-1", "store", "web"),
    ]).map((c) => c.name);
    expect(ordered).toEqual(["web-1", "old-1"]);
  });
});

describe("containerHeadings", () => {
  it("opens a project heading and a service heading where each changes", () => {
    const rows = orderByOwner([
      resource("web-1", "toolbox", "web"),
      resource("web-2", "toolbox", "web"),
      resource("api-1", "toolbox", "api"),
      platform("otterdeploy-caddy"),
      stray("redis-dev"),
    ]);
    expect(containerHeadings(rows)).toEqual([
      { group: "toolbox", service: service("api", "api") },
      { group: null, service: service("web", "web") },
      { group: null, service: null },
      { group: "Platform", service: null },
      { group: "Unmanaged", service: null },
    ]);
  });

  it("repeats the open headings at the top of a page so a page never starts headless", () => {
    const rows = orderByOwner([
      resource("web-1", "toolbox", "web"),
      resource("web-2", "toolbox", "web"),
    ]);
    expect(containerHeadings(rows.slice(1))).toEqual([
      { group: "toolbox", service: service("web", "web") },
    ]);
  });

  it("carries an unresolved resource's id, never a guessed name", () => {
    expect(containerHeadings([orphan("x", "res_9")])).toEqual([
      {
        group: "store",
        service: {
          resourceId: "res_9",
          resourceName: null,
          projectSlug: "store",
          environmentSlug: null,
        },
      },
    ]);
  });
});

describe("serviceHeadingView", () => {
  it("names a resolved resource and links to its panel", () => {
    expect(serviceHeadingView(service("web", "web"))).toEqual({
      kind: "link",
      label: "web",
      projectSlug: "toolbox",
      envSlug: "production",
      resourceId: "res_web",
    });
  });

  it("shows an unresolved resource as Unknown resource, with its id as secondary text", () => {
    expect(
      serviceHeadingView({
        resourceId: "res_unyx311ahrsiymm63pocur5d",
        resourceName: null,
        projectSlug: "store",
        environmentSlug: null,
      }),
    ).toEqual({
      kind: "unknown",
      label: "Unknown resource",
      resourceId: "res_unyx311ahrsiymm63pocur5d",
    });
  });

  it("names a resource it cannot link to without inventing a place for it", () => {
    expect(serviceHeadingView({ ...service("web", "web"), environmentSlug: null })).toEqual({
      kind: "text",
      label: "web",
    });
  });
});
