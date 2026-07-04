import { Building02Icon, GlobalIcon, StructureFolderIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as z from "zod";

import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { orpc } from "@/shared/server/orpc";

import { StepFrame, WizardActions, WizardField } from "./wizard-parts";

export interface CreatedOrg {
  id: string;
  slug: string;
  name: string;
}

// `.slugify()` alone — derives the slug live as the user types the name.
// Doesn't throw on short/empty input, just normalizes whatever's there.
const slugifier = z.string().slugify();

/** Flatten TanStack Form's mixed error shape into plain messages. */
function messages(errors: readonly unknown[]): string[] {
  return errors
    .map((e) => (typeof e === "string" ? e : (e as { message?: string } | undefined)?.message))
    .filter((m): m is string => Boolean(m));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Organization
// ─────────────────────────────────────────────────────────────────────────────

const orgSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  slug: slugifier
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer"),
});

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
    validators: { onChange: orgSchema },
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
        className="flex flex-col gap-4"
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

        <form.Subscribe
          selector={(s) => ({ isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
        >
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Base domain (skippable)
// ─────────────────────────────────────────────────────────────────────────────

// A permissive hostname check — the server is the source of truth and enforces
// the canonical FQDN rule, so this just catches obvious mistakes (scheme, path,
// whitespace) before a roundtrip.
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

const domainSchema = z.object({
  baseDomain: z
    .string()
    .trim()
    .refine(
      (v) => HOSTNAME_RE.test(v),
      "Enter a hostname like apps.acme.com — no http://, no path",
    ),
});

export function DomainStep({
  organizationId,
  onComplete,
  onSkip,
}: {
  organizationId: string;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const setDomain = useMutation({
    mutationKey: ["onboarding", "setBaseDomain"],
    mutationFn: async (baseDomain: string) => {
      await orpc.organization.setBaseDomain.call({ organizationId, baseDomain });
    },
    onSuccess: onComplete,
  });

  const form = useForm({
    defaultValues: { baseDomain: "" },
    validators: { onChange: domainSchema },
    onSubmit: async ({ value }) => {
      await setDomain.mutateAsync(value.baseDomain.trim());
    },
  });

  return (
    <StepFrame
      icon={GlobalIcon}
      title="Set a base domain"
      description={
        <>
          Deployed services get a public URL under this domain — a service named{" "}
          <span className="font-mono text-[0.8125rem] text-foreground">web</span> becomes{" "}
          <span className="font-mono text-[0.8125rem] text-foreground">web.apps.acme.com</span>.
          Point a wildcard{" "}
          <span className="font-mono text-[0.8125rem] text-foreground">*.apps.acme.com</span> record
          at this server. You can change or verify it later in Settings.
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        {setDomain.error ? (
          <Alert variant="destructive">
            <AlertDescription>{setDomain.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <form.Field name="baseDomain">
          {(field) => (
            <WizardField
              id={field.name}
              label="Base domain"
              placeholder="apps.acme.com"
              mono
              focusOnMount
              autoComplete="off"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.isTouched ? messages(field.state.meta.errors) : undefined}
            />
          )}
        </form.Field>

        <p className="text-xs leading-relaxed text-muted-foreground">
          No domain yet? Skip this — services stay reachable at the server&rsquo;s IP address until
          you add one.
        </p>

        <form.Subscribe
          selector={(s) => ({ isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
        >
          {({ isSubmitting, canSubmit }) => (
            <WizardActions
              onSkip={onSkip}
              submitLabel="Continue"
              pendingLabel="Saving…"
              pending={isSubmitting}
              disabled={!canSubmit}
            />
          )}
        </form.Subscribe>
      </form>
    </StepFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — First project
// ─────────────────────────────────────────────────────────────────────────────

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  slug: slugifier
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer"),
});

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
    validators: { onChange: projectSchema },
    onSubmit: async ({ value }) => {
      await createProject.mutateAsync(value);
    },
  });

  return (
    <StepFrame
      icon={StructureFolderIcon}
      title="Create your first project"
      description="A project groups the services, databases, and routes that ship together — like one app and its dependencies. We&rsquo;ll drop you straight into it."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
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
