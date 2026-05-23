import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { client, orpc } from "@/shared/server/orpc";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const schema = z.object({
  name: z.string().min(1, "Project name is required"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer")
    .regex(slugRegex, "Lowercase letters, numbers, dashes only"),
});

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateProjectDialog({ trigger }: { trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const queryClient = useQueryClient();

  const createProject = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      client.project.create(input),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.project.list.queryKey(),
      });
      toast.success(`Created project "${project.name}"`);
      setOpen(false);
    },
    onError: (error) => {
      setFormError(error.message);
    },
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await createProject.mutateAsync({
        name: value.name,
        slug: value.slug,
      });
    },
  });

  function reset() {
    form.reset();
    setFormError(null);
    setSlugTouched(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Projects group your services, databases, and routes.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    const next = e.target.value;
                    field.handleChange(next);
                    if (!slugTouched) {
                      form.setFieldValue("slug", deriveSlug(next));
                    }
                  }}
                  autoFocus
                />
                {field.state.meta.errors[0] ? (
                  <FieldError>{String(field.state.meta.errors[0])}</FieldError>
                ) : null}
              </Field>
            )}
          </form.Field>

          <form.Field name="slug">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>URL slug</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    setSlugTouched(true);
                    field.handleChange(e.target.value);
                  }}
                />
                {field.state.meta.errors[0] ? (
                  <FieldError>{String(field.state.meta.errors[0])}</FieldError>
                ) : null}
              </Field>
            )}
          </form.Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create project"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
