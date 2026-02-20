import { useState, useMemo } from "react";
import { orpc, client, queryClient } from "@/utils/orpc";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldError } from "@/components/ui/field";
import { ProjectCard } from "@/components/project/project-card";
import { HugeiconsIcon } from "@hugeicons/react";
import { GridViewIcon, ListViewIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { PlusIcon } from "lucide-react";
import * as z from "zod";

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

    // Fetch resources and environments for each project in parallel
    const enriched = await Promise.all(
      projects.items.map(async (project) => {
        try {
          const [resources, environments] = await Promise.all([
            context.queryClient.fetchQuery(
              orpc.resource.list.queryOptions({
                input: { projectId: project.id },
              }),
            ),
            context.queryClient.fetchQuery(
              orpc.environment.list.queryOptions({
                input: { projectId: project.id },
              }),
            ),
          ]);
          return {
            ...project,
            resources: resources.map((r) => ({
              kind: r.kind,
              status: r.status,
              name: r.name,
            })),
            environment: environments[0]?.name ?? "default",
          };
        } catch {
          return {
            ...project,
            resources: [],
            environment: "default",
          };
        }
      }),
    );

    return { projects: enriched, organizationId: context.auth.session.activeOrganizationId };
  },
});

type SortOption = "updated" | "name-asc" | "name-desc" | "newest" | "oldest";
type ViewMode = "architecture" | "list";

function CreateProjectDialog() {
  const { organizationId } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      name: "",
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Project name is required").max(128, "Name is too long"),
      }),
    },
    onSubmit: async ({ value }) => {
      const project = await client.project.create({
        organizationId,
        name: value.name.trim(),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.project.list.queryOptions({
          input: { organizationId },
        }).queryKey,
      });
      setOpen(false);
      form.reset();
      router.navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        New
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give your project a name to get started.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <Input
                    placeholder="My project"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    autoFocus
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter showCloseButton>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit}>
                  {isSubmitting ? "Creating..." : "Create project"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RouteComponent() {
  const { projects } = Route.useLoaderData();
  const [sort, setSort] = useState<SortOption>("updated");
  const [view, setView] = useState<ViewMode>("architecture");

  const sortedProjects = useMemo(() => {
    const items = [...projects];
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
  }, [projects, sort]);

  const count = projects.length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <CreateProjectDialog />
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
          {sortedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              name={project.name}
              environment={project.environment}
              resources={project.resources}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col rounded-xl border bg-card divide-y">
          {sortedProjects.map((project) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <span className="text-sm font-medium flex-1 truncate">{project.name}</span>
              <Badge variant="secondary" className="text-[10px]">
                {project.environment}
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {project.resources.length} {project.resources.length === 1 ? "resource" : "resources"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums w-28 text-right">
                {new Date(project.updatedAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}

      {count === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">No projects yet</p>
          <div className="mt-4">
            <CreateProjectDialog />
          </div>
        </div>
      )}
    </div>
  );
}
