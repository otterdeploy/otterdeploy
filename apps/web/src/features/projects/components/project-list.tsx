import { ProjectCard } from "./project-card";

interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
  serviceCount?: number;
  runningServiceCount?: number | null;
  databaseCount?: number;
  routeCount?: number;
}

export function ProjectList({
  orgSlug,
  projects,
}: {
  orgSlug: string;
  projects: ReadonlyArray<ProjectListItem>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} orgSlug={orgSlug} project={project} />
      ))}
    </div>
  );
}
