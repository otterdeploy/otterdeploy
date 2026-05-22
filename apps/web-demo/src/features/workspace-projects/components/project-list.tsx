import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { ProjectCard } from "./project-card";
import { CreateProjectDialog } from "./create-project-dialog";
import type { ProjectSummary } from "../types";

type Props = {
  summaries: ReadonlyArray<ProjectSummary>;
};

export function ProjectList({ summaries }: Props) {
  return (
    <div className="grid gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Open a project to manage its services, databases, and routes.</p>
        </div>
        <CreateProjectDialog />
      </div>

      {summaries.length === 0 ? (
        <Empty>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>Create your first project to get started.</EmptyDescription>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => (
            <ProjectCard key={summary.project.id} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}
