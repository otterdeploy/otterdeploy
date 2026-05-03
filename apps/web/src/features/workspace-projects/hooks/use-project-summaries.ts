import type { ProjectSummariesInput, ProjectSummary } from "../types";

// Pure derivation; named `use*` for API symmetry with other hooks. The route component
// passes pre-resolved counts; this just shapes them into ProjectSummary[].
export function useProjectSummaries(input: ProjectSummariesInput): ProjectSummary[] {
  return input.projects.map((project) => ({
    project,
    databases: { count: input.databaseCounts[project.id] ?? 0 },
    routes: { count: input.routeCounts[project.id] ?? 0 },
  }));
}
