import type { ProxyRouteFromApi, ProjectFromApi } from "@/features/project-canvas/api/schema";

export interface WorkspaceRouteRow {
  route: ProxyRouteFromApi;
  project: Pick<ProjectFromApi, "id" | "name" | "slug">;
}

export interface WorkspaceRoutesInput {
  projects: ReadonlyArray<ProjectFromApi>;
  routesByProject: Record<string, ReadonlyArray<ProxyRouteFromApi> | undefined>;
}
