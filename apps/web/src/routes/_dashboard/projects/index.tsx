import { useState, useMemo } from "react";
import { orpc } from "@/utils/orpc";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProjectCard, type ProjectResource } from "@/components/project/project-card";
import { type Kind, type Status } from "@/components/resource/node";
import { HugeiconsIcon } from "@hugeicons/react";
import { GridViewIcon, ListViewIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { PlusIcon } from "lucide-react";

export const Route = createFileRoute("/_dashboard/projects/")({
  component: RouteComponent,
  loader: async ({ context }) => {
    if (!context.auth.session.activeOrganizationId) throw new Error("No active organization");
    const projects = await context.queryClient.ensureQueryData(
      orpc.project.list.queryOptions({
        input: {
          organizationId: context.auth.session.activeOrganizationId,
        },
      }),
    );
    return { projects };
  },
});

// Mock resource data for project cards until a real API is available
const mockResources: Record<string, { environment: string; resources: ProjectResource[] }> = {};

function getMockData(projectId: string, projectName: string) {
  if (mockResources[projectId]) return mockResources[projectId];

  const kinds: Kind[] = ["web", "api", "worker", "database", "cache", "volume"];
  const statuses: Status[] = ["online", "online", "online", "degraded", "deploying", "stopped"];

  // Deterministic pseudo-random based on project name
  const seed = projectName.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const count = (seed % 4) + 2; // 2-5 resources

  const resources: ProjectResource[] = Array.from({ length: count }, (_, i) => ({
    kind: kinds[(seed + i) % kinds.length],
    status: statuses[(seed + i * 3) % statuses.length],
    name: `${kinds[(seed + i) % kinds.length]}-${i + 1}`,
  }));

  const envs = ["production", "staging", "development"];
  const data = { environment: envs[seed % envs.length], resources };
  mockResources[projectId] = data;
  return data;
}

type SortOption = "updated" | "name-asc" | "name-desc" | "newest" | "oldest";
type ViewMode = "architecture" | "list";

function RouteComponent() {
  const { projects } = Route.useLoaderData();
  const [sort, setSort] = useState<SortOption>("updated");
  const [view, setView] = useState<ViewMode>("architecture");

  const sortedProjects = useMemo(() => {
    const items = [...projects.items];
    switch (sort) {
      case "updated":
        return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      case "name-asc":
        return items.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return items.sort((a, b) => b.name.localeCompare(a.name));
      case "newest":
        return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case "oldest":
        return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      default:
        return items;
    }
  }, [projects.items, sort]);

  const count = projects.items.length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {count} {count === 1 ? "project" : "projects"}
        </span>

        <Select
          value={sort}
          onValueChange={(val) => setSort(val as SortOption)}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Last updated</SelectItem>
            <SelectItem value="name-asc">Name A–Z</SelectItem>
            <SelectItem value="name-desc">Name Z–A</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <ToggleGroup
            value={[view]}
            onValueChange={(values) => {
              if (values.length > 0) setView(values[0] as ViewMode);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="architecture" aria-label="Architecture view">
              <HugeiconsIcon icon={GridViewIcon} size={16} />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <HugeiconsIcon icon={ListViewIcon} size={16} />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Content */}
      {view === "architecture" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedProjects.map((project) => {
            const mock = getMockData(project.id, project.name);
            return (
              <ProjectCard
                key={project.id}
                id={project.id}
                name={project.name}
                environment={mock.environment}
                resources={mock.resources}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col rounded-xl border bg-card divide-y">
          {sortedProjects.map((project) => {
            const mock = getMockData(project.id, project.name);
            return (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span className="text-sm font-medium flex-1 truncate">{project.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {mock.environment}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {mock.resources.length} {mock.resources.length === 1 ? "resource" : "resources"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums w-28 text-right">
                  {new Date(project.updatedAt).toLocaleDateString()}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {count === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No projects yet</p>
          <Button size="sm" className="mt-4">
            <PlusIcon data-icon="inline-start" />
            Create your first project
          </Button>
        </div>
      )}
    </div>
  );
}
