import { describe, expect, it } from "vitest";

import type { ProjectFromApi, ProxyRouteFromApi } from "@/features/project-canvas/api/schema";

import { useWorkspaceRoutes } from "./use-workspace-routes";

function makeProject(over: Partial<ProjectFromApi> = {}): ProjectFromApi {
  return {
    id: "p",
    name: "Project",
    slug: "project",
    environmentId: "e",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as ProjectFromApi;
}

function makeRoute(over: Partial<ProxyRouteFromApi> = {}): ProxyRouteFromApi {
  return {
    id: "r",
    projectId: "p",
    resourceId: null,
    type: "http",
    domain: "example.com",
    upstreamHost: "h",
    upstreamPort: 80,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("useWorkspaceRoutes", () => {
  it("flattens routes from all projects with their owning project tag", () => {
    const rows = useWorkspaceRoutes({
      projects: [makeProject({ id: "a", name: "A" }), makeProject({ id: "b", name: "B" })],
      routesByProject: {
        a: [makeRoute({ id: "r1", projectId: "a", domain: "a.example.com" })],
        b: [makeRoute({ id: "r2", projectId: "b", domain: "b.example.com" })],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].route.domain).toBe("a.example.com");
    expect(rows[0].project.id).toBe("a");
    expect(rows[1].project.id).toBe("b");
  });

  it("skips projects with no resolved routes yet", () => {
    const rows = useWorkspaceRoutes({
      projects: [makeProject({ id: "a" })],
      routesByProject: {},
    });
    expect(rows).toHaveLength(0);
  });
});
