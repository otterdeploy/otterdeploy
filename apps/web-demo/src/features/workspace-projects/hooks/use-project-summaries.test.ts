import { describe, expect, it } from "vitest";
import { useProjectSummaries } from "./use-project-summaries";
import type { ProjectFromApi } from "@/features/project-canvas/api/schema";

function makeProject(over: Partial<ProjectFromApi> = {}): ProjectFromApi {
  return {
    id: "proj_1",
    name: "Acme",
    slug: "acme",
    environmentId: "env_1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as ProjectFromApi;
}

describe("useProjectSummaries", () => {
  it("returns one summary per project, in input order", () => {
    const summaries = useProjectSummaries({
      projects: [makeProject({ id: "a" }), makeProject({ id: "b" })],
      databaseCounts: {},
      routeCounts: {},
    });
    expect(summaries.map((s) => s.project.id)).toEqual(["a", "b"]);
  });

  it("returns zero counts when no per-project data has resolved", () => {
    const summaries = useProjectSummaries({
      projects: [makeProject({ id: "a" })],
      databaseCounts: {},
      routeCounts: {},
    });
    expect(summaries[0].databases.count).toBe(0);
    expect(summaries[0].routes.count).toBe(0);
  });

  it("uses provided counts when resolved", () => {
    const summaries = useProjectSummaries({
      projects: [makeProject({ id: "a" })],
      databaseCounts: { a: 3 },
      routeCounts: { a: 2 },
    });
    expect(summaries[0].databases.count).toBe(3);
    expect(summaries[0].routes.count).toBe(2);
  });
});
