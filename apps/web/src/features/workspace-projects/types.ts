import type { ProjectFromApi } from "@/features/project-canvas/api/schema";

export type ProjectSummary = {
  project: ProjectFromApi;
  databases: { count: number };
  routes: { count: number };
};

export type ProjectSummariesInput = {
  projects: ReadonlyArray<ProjectFromApi>;
  /** Map of projectId → resolved database count (undefined while pending). */
  databaseCounts: Record<string, number | undefined>;
  /** Map of projectId → resolved route count (undefined while pending). */
  routeCounts: Record<string, number | undefined>;
};
