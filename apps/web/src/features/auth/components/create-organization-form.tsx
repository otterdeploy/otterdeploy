import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

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

  const createOrgMutation = useMutation({
    mutationKey: ["createOrganization"],
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const created = await authClient.organization.create({ name, slug });

      if (created.error || !created.data) {
        throw new Error(
          created.error?.message ?? "Could not create organization",
        );
      }

      const activated = await authClient.organization.setActive({
        organizationId: created.data.id,
      });
      if (activated.error) {
        throw new Error(
          `Could not activate organization: ${activated.error.message ?? "Unknown error"}`,
        );
      }

      return created.data;
    },
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await createOrgMutation.mutateAsync({
        name: value.name,
        slug: value.slug,
      });
      void navigate({ to: "/" });
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
        {createOrgMutation.error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {createOrgMutation.error.message}
            </AlertDescription>
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
                  form.setFieldValue("slug", deriveSlug(next));
                }}
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
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.map((err) => (
                <FieldError key={err?.message}>{err?.message}</FieldError>
              ))}
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
