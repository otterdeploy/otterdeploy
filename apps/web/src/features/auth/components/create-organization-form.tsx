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

// `.slugify()` alone — used to derive the slug live as the user types the name.
// Doesn't throw on short/empty input, just normalizes whatever's there.
const slugifier = z.string().slugify();

const schema = z.object({
  name: z.string().min(1, "Organization name is required"),
  slug: slugifier
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer"),
});

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
              <FieldLabel
                htmlFor={field.name}
                className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground"
              >
                Name
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                className="h-11 rounded-lg bg-muted px-3.5"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => {
                  const next = e.target.value;
                  field.handleChange(next);
                  form.setFieldValue("slug", slugifier.parse(next));
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
              <FieldLabel
                htmlFor={field.name}
                className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground"
              >
                URL slug
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                className="h-11 rounded-lg bg-muted px-3.5"
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
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-11 w-full rounded-lg bg-foreground font-semibold text-background hover:bg-foreground/90"
            >
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthShell>
  );
}
