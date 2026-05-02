import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, FolderPlus, Loader2, PlusIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_dashboard/")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.project.list(),
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      client.project.create({
        name: name.trim(),
        slug: slug.trim(),
      }),
    onSuccess: async (project) => {
      setName("");
      setSlug("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    },
  });

  const createErrorMessage =
    createMutation.error instanceof Error ? createMutation.error.message : null;
  const suggestedSlug = useMemo(() => toSlug(name), [name]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(128,89,42,0.14),_transparent_28%),linear-gradient(180deg,_rgba(255,252,247,0.96),_rgba(250,247,241,1))] p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="rounded-[2rem] border border-border/70 bg-background/88 px-6 py-8 shadow-xl shadow-black/5 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="warning">Otterstack Projects</Badge>
              <div className="space-y-2">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance">
                  Create a project, then open it and start attaching databases and Caddy config.
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  This is the shortest possible launcher: name it, pick a slug, and jump straight
                  into the project canvas.
                </p>
              </div>
            </div>

            <Dialog onOpenChange={setOpen} open={open}>
              <DialogTrigger render={<Button size="lg" />}>
                <PlusIcon />
                New Project
              </DialogTrigger>
              <DialogPopup className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Project</DialogTitle>
                  <DialogDescription>
                    A default development environment is created automatically so the project is
                    usable right away.
                  </DialogDescription>
                </DialogHeader>

                <form
                  className="space-y-4 p-6 pt-0"
                  onSubmit={(event) => {
                    event.preventDefault();

                    if (!name.trim() || !slug.trim() || createMutation.isPending) {
                      return;
                    }

                    createMutation.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="project-name">Name</Label>
                    <Input
                      id="project-name"
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setName(nextName);

                        if (!slug.trim() || slug === suggestedSlug) {
                          setSlug(toSlug(nextName));
                        }
                      }}
                      placeholder="Acme API"
                      value={name}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="project-slug">Slug</Label>
                    <Input
                      id="project-slug"
                      onChange={(event) => setSlug(toSlug(event.target.value))}
                      placeholder="acme-api"
                      value={slug}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used in hostnames and internal identifiers.
                    </p>
                  </div>

                  {createErrorMessage ? (
                    <Alert variant="error">
                      <AlertCircle />
                      <AlertTitle>Couldn’t create project</AlertTitle>
                      <AlertDescription>{createErrorMessage}</AlertDescription>
                    </Alert>
                  ) : null}

                  <DialogFooter variant="bare">
                    <Button
                      disabled={!name.trim() || !slug.trim() || createMutation.isPending}
                      type="submit"
                    >
                      {createMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <FolderPlus className="size-4" />
                      )}
                      Create Project
                    </Button>
                  </DialogFooter>
                </form>
              </DialogPopup>
            </Dialog>
          </div>
        </section>

        {query.isError ? (
          <Alert variant="error">
            <AlertCircle />
            <AlertTitle>Failed to load projects</AlertTitle>
            <AlertDescription>
              {query.error instanceof Error ? query.error.message : "Unable to load projects."}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {query.isLoading ? (
            <div className="col-span-full flex items-center gap-2 rounded-[1.75rem] border border-dashed border-border bg-background/70 px-5 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading projects...
            </div>
          ) : query.data && query.data.length > 0 ? (
            query.data.map((project) => (
              <Link
                className="group rounded-[1.75rem] border border-border/70 bg-background/88 p-5 shadow-lg shadow-black/5 transition-transform hover:-translate-y-0.5 hover:border-foreground/20"
                key={project.id}
                params={{ projectId: project.id }}
                to="/project/$projectId"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="text-lg font-semibold">{project.name}</div>
                    <div className="text-sm text-muted-foreground">{project.slug}</div>
                  </div>
                  <Badge variant="outline">project</Badge>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm text-muted-foreground">
                  <span>Default env: {project.environmentId}</span>
                  <span className="inline-flex items-center gap-1 text-foreground">
                    Open
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full rounded-[1.75rem] border border-dashed border-border bg-background/70 px-5 py-10 text-sm text-muted-foreground">
              No projects yet. Create the first one above and you’ll be taken straight into it.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function toSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "";
}
