import { FolderIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { ID_PREFIX, type Id } from "@otterstack/shared/id";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

type ProjectListItem = {
  id: string;
  name: string;
  slug: string;
};

export function ProjectList({
  orgSlug,
  projects,
}: {
  orgSlug: string;
  projects: ReadonlyArray<ProjectListItem>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <Link
          key={project.id}
          to="/$orgSlug/$projectId"
          params={{
            orgSlug,
            projectId: project.id as Id<typeof ID_PREFIX.project>,
          }}
          className="group block"
        >
          <Card className="transition-colors group-hover:border-foreground/20 group-hover:bg-card/80">
            <CardHeader className="flex flex-row items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <HugeiconsIcon
                  icon={FolderIcon}
                  strokeWidth={2}
                  className="size-4"
                />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="truncate text-sm">
                  {project.name}
                </CardTitle>
                <CardContent className="px-0 pt-1 font-mono text-xs text-muted-foreground">
                  {project.slug}
                </CardContent>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
