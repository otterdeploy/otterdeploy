import type { ProxyRouteFromApi, ProjectFromApi } from "@/features/project-canvas/api/schema";

export type WorkspaceRouteRow = {
  route: ProxyRouteFromApi;
  project: Pick<ProjectFromApi, "id" | "name" | "slug">;
};

export type WorkspaceRoutesInput = {
  projects: ReadonlyArray<ProjectFromApi>;
  routesByProject: Record<string, ReadonlyArray<ProxyRouteFromApi> | undefined>;
};
