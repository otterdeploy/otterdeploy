import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import type { ProjectSlug } from "@otterdeploy/shared/id";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { envCollection } from "@/features/projects/data/env";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EnvironmentCreateDialog({ projectId, open, onOpenChange }: Props) {
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: ({ value }) => {
      const slug = value.slug;
      const id = createId(ID_PREFIX.environment);

      // Optimistic insert — the row is already in the collection, so close
      // instantly. tx.isPersisted.promise rolls the row back on reject.
      const tx = envCollection.insert({
        id,
        name: value.name.trim(),
        slug,
        projectId: projectId as ProjectSlug,
        createdAt: new Date(),
      });

      // Switch the URL to the freshly-created env so the user lands on it.
      void navigate({ search: (prev) => ({ ...prev, env: slug }) });
      setOpen(false);
      tx.isPersisted.promise.catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to create environment",
        ),
      );
    },
  });

  // Reset on close so the next open starts fresh.
  const setOpen = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create environment</DialogTitle>
          <DialogDescription>
            Spin up a new environment to deploy to alongside production.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) =>
                value.trim().length === 0 ? "Name is required" : undefined,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  autoFocus
                  placeholder="Staging"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    const next = e.target.value;
                    field.handleChange(next);
                    // Live-derive the slug from the name as the user types.
                    form.setFieldValue("slug", slugify(next));
                  }}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="slug"
            validators={{
              onChange: ({ value }) =>
                value.length < 2 ? "Slug must be at least 2 characters" : undefined,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Slug</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  className="font-mono"
                  placeholder="staging"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(slugify(e.target.value))}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button type="submit" disabled={!canSubmit}>
                  Create environment
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
