import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { useForm, useStore } from "@tanstack/react-form";
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
import { projectCollection } from "../data/project";

import { eq, useLiveQuery } from "@tanstack/react-db";

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
    onSubmit: ({ value, ...test }) => {
      const tx = projectCollection.insert({
        ...value,
        environmentId: null,
        id: createId(ID_PREFIX.project),
        databaseCount: 0,
        stackFile: null,
        stackFileVersion: 0,
        lastAppliedFile: null,
        lastAppliedAt: null,
        customDomain: null,
        customDomainVerifiedAt: null,
        customDomainVerifyToken: null,
        // Build pipeline binding — wired later via Settings → Build, so
        // the optimistic row starts unconfigured. Defaults match the
        // server's row defaults so a refetch doesn't flip these out.
        gitRepoId: null,
        productionBranch: "main",
        containerRegistryId: null,
        imageRepository: null,
        nixpacksConfig: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Close instantly — the optimistic row is already in the collection.
      // Surface server-side failures asynchronously; tanstack/db rolls back
      // the optimistic row on rejection.
      setOpen(false);
      tx.isPersisted.promise.catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Failed to create project",
        );
      });
    },
  });

  // Subscribe to the slug value so this component re-renders on every
  // keystroke. Without this, `form.getFieldValue("slug")` would only read
  // the value at the initial render and the live query below would never
  // re-run.
  const slug = useStore(form.store, (s) => s.values.slug);

  // Reactive uniqueness check against rows already in the collection. No
  // server roundtrip needed — `projectCollection` holds the org's projects.
  const { data: conflict } = useLiveQuery(
    (q) =>
      q
        .from({ p: projectCollection })
        .where(({ p }) => eq(p.slug, slug))
        .findOne(),
    [slug],
  );

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
                  <FieldError key={err?.message}>{err?.message}</FieldError>
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
                  <FieldError key={err?.message}>{err?.message}</FieldError>
                ))}
                {conflict && conflict.slug === slug ? (
                  <FieldError>Slug "{slug}" is already in use</FieldError>
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
            <form.Subscribe
              selector={(s) => ({
                isSubmitting: s.isSubmitting,
                canSubmit: s.canSubmit,
              })}
            >
              {({ isSubmitting, canSubmit }) => {
                const hasSlugConflict = !!conflict && conflict.slug === slug;
                return (
                  <Button
                    type="submit"
                    disabled={isSubmitting || !canSubmit || hasSlugConflict}
                  >
                    {isSubmitting ? "Creating…" : "Create project"}
                  </Button>
                );
              }}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
