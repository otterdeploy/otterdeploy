import { useMemo, useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, FolderPlus, Loader2, PlusIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client, queryClient } from "@/utils/orpc";

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateProjectDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => client.project.create({ name: name.trim(), slug: slug.trim() }),
    onSuccess: async (project) => {
      setName("");
      setSlug("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await navigate({
        to: "/project/$projectId",
        params: { projectId: project.id },
      });
    },
  });

  const errorMessage = createMutation.error instanceof Error ? createMutation.error.message : null;
  const suggestedSlug = useMemo(() => toSlug(name), [name]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="lg" />}>
        <PlusIcon />
        New project
      </DialogTrigger>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            A default development environment is created automatically so the project is usable
            right away.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 p-6 pt-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !slug.trim() || createMutation.isPending) return;
            createMutation.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              placeholder="Acme API"
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!slug.trim() || slug === suggestedSlug) setSlug(toSlug(next));
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
            <Input
              id="project-slug"
              placeholder="acme-api"
              value={slug}
              onChange={(event) => setSlug(toSlug(event.target.value))}
            />
            <FieldDescription>Used in hostnames and internal identifiers.</FieldDescription>
          </Field>

          {errorMessage ? (
            <Alert variant="error">
              <AlertCircle />
              <AlertTitle>Couldn't create project</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
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
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
