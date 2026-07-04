import { Building02Icon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

import { messages, nameAndSlugSchema, slugifier, type CreatedOrg } from "./shared";
import { StepFrame, WizardActions, WizardField } from "./wizard-parts";

export function OrganizationStep({ onComplete }: { onComplete: (org: CreatedOrg) => void }) {
  const createOrg = useMutation({
    mutationKey: ["onboarding", "createOrganization"],
    mutationFn: async ({ name, slug }: { name: string; slug: string }): Promise<CreatedOrg> => {
      const created = await authClient.organization.create({ name, slug });
      if (created.error || !created.data) {
        throw new Error(created.error?.message ?? "Could not create organization");
      }

      const activated = await authClient.organization.setActive({
        organizationId: created.data.id,
      });
      if (activated.error) {
        throw new Error(
          `Could not activate organization: ${activated.error.message ?? "Unknown error"}`,
        );
      }

      return { id: created.data.id, slug: created.data.slug, name: created.data.name };
    },
    onSuccess: onComplete,
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: nameAndSlugSchema },
    onSubmit: async ({ value }) => {
      await createOrg.mutateAsync(value);
    },
  });

  return (
    <StepFrame
      icon={Building02Icon}
      title="Create your organization"
      description="An organization is your top-level workspace — it owns your projects, servers, domains, and team. You can create more later or invite people in."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-1 flex-col gap-4"
        noValidate
      >
        {createOrg.error ? (
          <Alert variant="destructive">
            <AlertDescription>{createOrg.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="name">
          {(field) => (
            <WizardField
              id={field.name}
              label="Name"
              placeholder="Acme"
              focusOnMount
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(next) => {
                field.handleChange(next);
                form.setFieldValue("slug", slugifier.parse(next));
              }}
              errors={messages(field.state.meta.errors)}
            />
          )}
        </form.Field>

        <form.Field name="slug">
          {(field) => (
            <WizardField
              id={field.name}
              label="URL slug"
              mono
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={messages(field.state.meta.errors)}
            />
          )}
        </form.Field>

        <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}>
          {({ isSubmitting, canSubmit }) => (
            <WizardActions
              submitLabel="Continue"
              pendingLabel="Creating…"
              pending={isSubmitting}
              disabled={!canSubmit}
            />
          )}
        </form.Subscribe>
      </form>
    </StepFrame>
  );
}
