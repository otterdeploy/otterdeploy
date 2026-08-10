import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useState, type ReactElement } from "react";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate, useParams } from "@tanstack/react-router";
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

// `.slugify()` alone, used to derive the slug live as the user types the name.
// Doesn't throw on short/empty input, just normalizes whatever's there.
const slugifier = z.string().slugify();

const schema = z.object({
  name: z.string().min(1, "Project name is required"),
  slug: slugifier
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer"),
});

/** The optimistic row for a brand-new project: everything the collection needs
 *  so the destination route can render immediately, with every count and
 *  binding at its true empty value. Module-level because it's pure data. It
 *  also keeps the component under the max-lines-per-function ceiling. */
function newProjectRow(value: { name: string; slug: string }) {
  const now = new Date();
  return {
    ...value,
    environmentId: null,
    id: createId(ID_PREFIX.project),
    databaseCount: 0,
    // A brand-new project has nothing configured or running yet.
    serviceCount: 0,
    routeCount: 0,
    runningServiceCount: 0,
    stackFile: null,
    stackFileVersion: 0,
    lastAppliedFile: null,
    lastAppliedAt: null,
    customDomain: null,
    customDomainVerifiedAt: null,
    customDomainVerifyToken: null,
    // Git source / image target moved to the SERVICE, no project-level
    // build binding on the row anymore.
    nixpacksConfig: null,
    graphLayout: {},
    createdAt: now,
    updatedAt: now,
  };
}

interface CreateProjectDialogProps {
  /** Uncontrolled usage (org-home "New project" button): omit `open` and
   *  the dialog manages its own visibility, toggled by this trigger. */
  trigger?: ReactElement;
  /** Controlled usage (header project switcher's "New project" menu item).
   *  The caller owns the open state since the trigger lives inside a
   *  DropdownMenuItem that unmounts on click, before an internally-tracked
   *  open state would have a chance to flip. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateProjectDialog({
  trigger,
  open: openProp,
  onOpenChange,
}: CreateProjectDialogProps) {
  const navigate = useNavigate();
  // Both mount points (org home, header switcher) live under /$orgSlug, so the
  // slug is always in scope here, no prop-drilling from the two callers.
  const { orgSlug } = useParams({ from: "/_app/$orgSlug" });
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (!isControlled) setOpenState(next);
    onOpenChange?.(next);
  };

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      const tx = projectCollection.insert(newProjectRow(value));

      // Close and go straight to the new project. The optimistic row is
      // already in `projectCollection`, so the destination renders its real
      // name and slug immediately: there is no server round-trip to wait on
      // and nothing to spin against ("fast is a feature": creating a thing
      // should land you on the thing).
      setOpen(false);
      void navigate({
        to: "/$orgSlug/$projectSlug",
        params: { orgSlug, projectSlug: value.slug as ProjectSlug },
      });

      // Surface server-side failures asynchronously; tanstack/db rolls back
      // the optimistic row on rejection. Bounce back off the now-dead route so
      // the operator isn't stranded on a project that no longer exists.
      // "honest about system state" cuts both ways: the optimistic jump is
      // only honest if a rejection undoes it visibly.
      tx.isPersisted.promise.catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to create project");
        void navigate({ to: "/$orgSlug", params: { orgSlug } });
      });
    },
  });

  // Subscribe to the slug value so this component re-renders on every
  // keystroke. Without this, `form.getFieldValue("slug")` would only read
  // the value at the initial render and the live query below would never
  // re-run.
  const slug = useStore(form.store, (s) => s.values.slug);

  // Reactive uniqueness check against rows already in the collection. No
  // server roundtrip needed. `projectCollection` holds the org's projects.
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
      {trigger ? <DialogTrigger render={trigger} /> : null}
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
                  <Button type="submit" disabled={isSubmitting || !canSubmit || hasSlugConflict}>
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
