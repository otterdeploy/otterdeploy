import type { ProjectFromApi } from "@/features/project-canvas/api/schema";

export interface ProjectSummary {
  project: ProjectFromApi;
  databases: { count: number };
  routes: { count: number };
}

export interface ProjectSummariesInput {
  projects: ReadonlyArray<ProjectFromApi>;
  /** Map of projectId → resolved database count (undefined while pending). */
  databaseCounts: Record<string, number | undefined>;
  /** Map of projectId → resolved route count (undefined while pending). */
  routeCounts: Record<string, number | undefined>;
}
