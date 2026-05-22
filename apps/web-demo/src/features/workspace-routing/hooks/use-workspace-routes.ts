import type { WorkspaceRouteRow, WorkspaceRoutesInput } from "../types";

// Pure derivation; named `use*` for API symmetry. Flattens per-project route arrays
// into a single workspace-wide list, attaching the owning project for display.
export function useWorkspaceRoutes(input: WorkspaceRoutesInput): WorkspaceRouteRow[] {
  const rows: WorkspaceRouteRow[] = [];
  for (const project of input.projects) {
    const routes = input.routesByProject[project.id];
    if (!routes) continue;
    for (const route of routes) {
      rows.push({ route, project: { id: project.id, name: project.name, slug: project.slug } });
    }
  }
  return rows;
}
