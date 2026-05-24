import { useForm } from "@tanstack/react-form";
import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import * as z from "zod";

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
import { createId, ID_PREFIX } from "@otterstack/shared/id";
import { projectCollection } from "../data/project";

// `.slugify()` alone — used to derive the slug live as the user types the name.
// Doesn't throw on short/empty input, just normalizes whatever's there.
const slugifier = z.string().slugify();

const schema = z.object({
  name: z.string().min(1, "Project name is required"),
  slug: slugifier
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer"),
});

export function CreateProjectDialog({ trigger }: { trigger: ReactElement }) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      const tx = projectCollection.insert({
        ...value,
        environmentId: null,
        id: createId(ID_PREFIX.project),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (tx.error?.message) toast.error(tx.error.message);
      else setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
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
          {/*{isError ? (
            <Alert variant="destructive">
              <AlertDescription>{createProject.error.message}</AlertDescription>
            </Alert>
          ) : null}*/}

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
                    form.setFieldValue("slug", slugifier.parse(next));
                  }}
                  autoFocus
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError>{err?.message}</FieldError>
                ))}
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
                    field.handleChange(e.target.value);
                  }}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError>{err?.message}</FieldError>
                ))}
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
