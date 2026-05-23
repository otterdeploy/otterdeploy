import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "./auth-shell";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const schema = z.object({
  name: z.string().min(1, "Organization name is required"),
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

export function CreateOrganizationForm() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const created = await authClient.organization.create({
        name: value.name,
        slug: value.slug,
      });
      if (created.error || !created.data) {
        setFormError(created.error?.message ?? "Could not create organization");
        return;
      }
      const activated = await authClient.organization.setActive({
        organizationId: created.data.id,
      });
      if (activated.error) {
        setFormError(
          activated.error.message ?? "Could not activate organization",
        );
        return;
      }
      // post-rename task wires the real /$orgSlug navigation
      void navigate({ to: "/" as "/" });
    },
  });

  return (
    <AuthShell
      title="Create your organization"
      description="Organizations group your projects, services, and members."
    >
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

        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  );
}
