import { StructureFolderIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { orpc } from "@/shared/server/orpc";

import { messages, nameAndSlugSchema, slugifier } from "./shared";
import { StepFrame, WizardActions, WizardField } from "./wizard-parts";

export function ProjectStep({
  onCreated,
  onSkip,
}: {
  onCreated: (projectSlug: string) => void;
  onSkip: () => void;
}) {
  const createProject = useMutation({
    mutationKey: ["onboarding", "createProject"],
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const created = await orpc.project.create.call({ name, slug });
      return created.slug;
    },
    onSuccess: onCreated,
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: { onChange: nameAndSlugSchema },
    onSubmit: async ({ value }) => {
      await createProject.mutateAsync(value);
    },
  });

  return (
    <StepFrame
      icon={StructureFolderIcon}
      title="Create your first project"
      description="A project groups the services, databases, and routes that ship together — like one app and its dependencies. We’ll drop you straight into it."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-1 flex-col gap-4"
        noValidate
      >
        {createProject.error ? (
          <Alert variant="destructive">
            <AlertDescription>{createProject.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="name">
          {(field) => (
            <WizardField
              id={field.name}
              label="Name"
              placeholder="Storefront"
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

        <form.Subscribe
          selector={(s) => ({ isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
        >
          {({ isSubmitting, canSubmit }) => (
            <WizardActions
              onSkip={onSkip}
              skipLabel="I'll do this later"
              submitLabel="Create project"
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
