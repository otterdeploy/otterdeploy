import { describe, expect, it } from "vitest";
import { renderWithRouter } from "@/test/utils";
import { ProjectCard } from "./project-card";
import type { ProjectSummary } from "../types";

const summary: ProjectSummary = {
  project: {
    id: "proj_1",
    name: "Acme API",
    slug: "acme-api",
    environmentId: "env_1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as ProjectSummary["project"],
  databases: { count: 2 },
  routes: { count: 1 },
};

describe("ProjectCard", () => {
  it("links to the project canvas", async () => {
    const { container } = await renderWithRouter(<ProjectCard summary={summary} />);
    const link = container.querySelector("a[data-project-card]");
    expect(link?.getAttribute("href")).toBe("/project/proj_1");
  });

  it("shows project name, slug, and counts", async () => {
    const { container } = await renderWithRouter(<ProjectCard summary={summary} />);
    expect(container.textContent).toMatch(/Acme API/);
    expect(container.textContent).toMatch(/acme-api/);
    expect(container.textContent).toMatch(/2.*databases/i);
    expect(container.textContent).toMatch(/1.*route/i);
  });
});
