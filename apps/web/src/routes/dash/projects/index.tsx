import { queries } from "@otterdeploy/zero/queries";
import { createFileRoute } from "@tanstack/react-router";

import { ProjectCard } from "@/components/project/project-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GridViewIcon, ListViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { mutators } from "@otterdeploy/zero/mutators";
import { useQuery } from "@rocicorp/zero/react";
import { useForm } from "@tanstack/react-form";
import { Link, useRouter } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Activity, useMemo, useState } from "react";
import * as z from "zod";

export const Route = createFileRoute("/dash/projects/")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const organizationId = context.auth.session.activeOrganizationId;

    if (!organizationId) {
      throw new Error("Organization ID is required");
    }
    return {
      organizationId,
    };
  },
});

type SortOption = "updated" | "name-asc" | "name-desc" | "newest" | "oldest";
type ViewMode = "architecture" | "list";

function CreateProjectDialog() {
  const { organizationId } = Route.useRouteContext();
  const router = useRouter();
  const { zero } = router.options.context;
  const { auth } = Route.useRouteContext();
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
      if (!zero) return;
      const id = crypto.randomUUID();
      const slug = value.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");

      zero.mutate(
        mutators.project.create({
          id,
          organizationId,
          ownerId: auth.user.id,
          name: slug,
          slug,
          now: Date.now(),
          defaultEnvironmentId: crypto.randomUUID(),
        }),
      );
      setOpen(false);
      form.reset();
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
            <DialogDescription>Give your project a name to get started.</DialogDescription>
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

const SORT_LABELS: Record<SortOption, string> = {
  updated: "Recent Activity",
  "name-asc": "Name A\u2013Z",
  "name-desc": "Name Z\u2013A",
  newest: "Newest First",
  oldest: "Oldest First",
};

function RouteComponent() {
  const { organizationId } = Route.useRouteContext();

  const [sort, setSort] = useState<SortOption>("updated");
  const [view, setView] = useState<ViewMode>("architecture");

  const [projects] = useQuery(queries.project.list({ organizationId }));

  const sortedProjects = useMemo(() => {
    const items = projects;
    switch (sort) {
      case "updated":
        return items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      case "name-asc":
        return items.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return items.sort((a, b) => b.name.localeCompare(a.name));
      case "newest":
        return items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      case "oldest":
        return items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      default:
        return items;
    }
  }, [projects, sort]);

  const count = projects.length;

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <CreateProjectDialog />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground tabular-nums">
          {count} {count === 1 ? "Project" : "Projects"}
        </span>

        <Select
          value={sort}
          onValueChange={(val) => {
            if (val) setSort(val);
          }}
        >
          <SelectTrigger
            size="sm"
            className="border-none bg-transparent shadow-none ring-0 focus-visible:ring-0 gap-1 px-0 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-muted-foreground/60">Sort By:</span>
            <span>{SORT_LABELS[sort]}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recent Activity</SelectItem>
            <SelectItem value="name-asc">Name A&#x2013;Z</SelectItem>
            <SelectItem value="name-desc">Name Z&#x2013;A</SelectItem>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground/60">Views</span>
          <ToggleGroup
            value={[view]}
            onValueChange={(values) => {
              if (values[0]) setView(values[0] as ViewMode);
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

      <Activity mode={view === "architecture" ? "visible" : "hidden"}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sortedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              name={project.name}
              environment="default"
              resources={[]}
            />
          ))}
        </div>
      </Activity>

      <Activity mode={view === "list" ? "visible" : "hidden"}>
        <div className="flex flex-col rounded-2xl border border-border/60 bg-card divide-y divide-border/40">
          {sortedProjects.map((project) => {
            return (
              <Link
                key={project.id}
                to="/dash/projects/$projectId"
                params={{ projectId: project.id }}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
              >
                <span className="text-[15px] font-medium flex-1 truncate">{project.name}</span>
                <span className="text-sm text-muted-foreground">default</span>
                <span className="text-muted-foreground/30 select-none">&middot;</span>
                <span className="text-sm text-muted-foreground tabular-nums">0/0 online</span>
                <span className="text-sm text-muted-foreground tabular-nums w-28 text-right">
                  {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : ""}
                </span>
              </Link>
            );
          })}
        </div>
      </Activity>

      {count === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted-foreground text-sm">No projects yet</p>
          <div className="mt-5">
            <CreateProjectDialog />
          </div>
        </div>
      )}
    </div>
  );
}
