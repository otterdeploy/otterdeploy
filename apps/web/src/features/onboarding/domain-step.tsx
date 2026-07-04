import { GlobalIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as z from "zod";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { orpc } from "@/shared/server/orpc";

import { messages } from "./shared";
import { StepFrame, WizardActions, WizardField } from "./wizard-parts";

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
      description="Where your deployed apps and databases get their public URLs — not the dashboard itself."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-1 flex-col gap-4"
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
              placeholder="acme.com"
              mono
              focusOnMount
              autoComplete="off"
              hint={
                <>
                  A service <span className="font-mono text-foreground">web</span> in project{" "}
                  <span className="font-mono text-foreground">store</span> is published at{" "}
                  <span className="font-mono text-foreground">web-store.apps.acme.com</span>. Point
                  a wildcard <span className="font-mono text-foreground">*.apps.acme.com</span>{" "}
                  record (and <span className="font-mono text-foreground">*.db.acme.com</span> for
                  databases) at this server.
                </>
              }
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.isTouched ? messages(field.state.meta.errors) : undefined}
            />
          )}
        </form.Field>

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
