/**
 * Register-an-identity-provider dialog.
 *
 * Collects the four things every OIDC IdP gives you — issuer URL, client id,
 * client secret — plus the email domain that routes to it. The discovery
 * endpoint is optional because the standard location is derivable from the
 * issuer; it's exposed for the IdPs that put it somewhere non-standard.
 *
 * The client secret is write-only from here on: once submitted it lives in
 * `sso_provider.oidc_config` and the list endpoint only ever returns the last
 * four characters of the client ID. Changing a secret means re-registering,
 * which is deliberate — a UI that could display it would be a UI that could
 * leak it.
 */

import { useForm } from "@tanstack/react-form";
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
} from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

import { useRegisterSsoProvider } from "./data/use-sso-providers";

/**
 * A bare email domain — "acme.com", never "@acme.com" or a full URL. This is
 * matched against the part of a sign-in address after the `@`, so anything else
 * silently never matches and the operator is left wondering why SSO "doesn't
 * work". Rejecting it at the form is much kinder than debugging it later.
 */
const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Lowercase + strip a pasted `@` or surrounding whitespace before validating,
 *  so the obvious paste of "@acme.com" is corrected rather than rejected. */
function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

/** A stable, URL-safe handle. It ends up in the IdP's redirect URI
 *  (`/sso/callback/<providerId>`), so it cannot contain anything that would
 *  need escaping there. */
const providerIdPattern = /^[a-z0-9][a-z0-9-]*$/;

/**
 * One labelled text field, rendered from a TanStack Form field API.
 *
 * The six fields below differ only by label, placeholder, type and hint, so
 * inlining each one's Field/Label/Input/errors block six times made the dialog
 * 208 lines of near-identical JSX — over the 150-line function cap, and hard to
 * scan for the parts that actually differ.
 */
function ProviderField({
  field,
  label,
  placeholder,
  hint,
  type,
}: {
  // The TanStack field API for a string-valued field. Kept structural rather
  // than importing the generic FieldApi type, which would need the whole form
  // shape threaded through for no added safety at this call site.
  field: {
    name: string;
    state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  };
  label: string;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        autoComplete={type === "password" ? "off" : undefined}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      {field.state.meta.errors.map((error) => (
        <FieldError key={error?.message}>{error?.message}</FieldError>
      ))}
    </Field>
  );
}

export function RegisterProviderDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const register = useRegisterSsoProvider(organizationId);

  const form = useForm({
    defaultValues: {
      providerId: "",
      issuer: "",
      domain: "",
      clientId: "",
      clientSecret: "",
      discoveryEndpoint: "",
    },
    validators: {
      onSubmit: z.object({
        providerId: z
          .string()
          .min(1, "Required")
          .regex(providerIdPattern, "Lowercase letters, numbers and hyphens only"),
        issuer: z.url("Must be a full URL, e.g. https://acme.okta.com"),
        domain: z
          .string()
          .min(1, "Required")
          .transform(normalizeDomain)
          .refine((v) => domainPattern.test(v), "Enter a bare domain, e.g. acme.com"),
        clientId: z.string().min(1, "Required"),
        clientSecret: z.string().min(1, "Required"),
        discoveryEndpoint: z.union([z.literal(""), z.url("Must be a full URL")]),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        await register.mutateAsync({
          providerId: value.providerId.trim(),
          issuer: value.issuer.trim(),
          domain: normalizeDomain(value.domain),
          clientId: value.clientId.trim(),
          clientSecret: value.clientSecret,
          discoveryEndpoint: value.discoveryEndpoint.trim() || undefined,
        });
        toast.success("Identity provider registered");
        form.reset();
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not register provider");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add identity provider</DialogTitle>
          <DialogDescription>
            Anyone whose email address is at this domain will sign in through your provider instead
            of a password.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <form.Field name="providerId">
            {(field) => (
              <ProviderField
                field={field}
                label="Provider ID"
                placeholder="okta"
                hint="Appears in the redirect URI you give your IdP. Cannot be changed later."
              />
            )}
          </form.Field>

          <form.Field name="domain">
            {(field) => <ProviderField field={field} label="Email domain" placeholder="acme.com" />}
          </form.Field>

          <form.Field name="issuer">
            {(field) => (
              <ProviderField field={field} label="Issuer URL" placeholder="https://acme.okta.com" />
            )}
          </form.Field>

          <form.Field name="clientId">
            {(field) => <ProviderField field={field} label="Client ID" />}
          </form.Field>

          <form.Field name="clientSecret">
            {(field) => (
              <ProviderField
                field={field}
                label="Client secret"
                type="password"
                hint="Stored encrypted and never shown again. To rotate it, remove the provider and add it back."
              />
            )}
          </form.Field>

          <form.Field name="discoveryEndpoint">
            {(field) => (
              <ProviderField
                field={field}
                label="Discovery endpoint (optional)"
                placeholder="https://acme.okta.com/.well-known/openid-configuration"
                hint="Leave blank to derive it from the issuer."
              />
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state}>
              {(state) => (
                <Button type="submit" disabled={!state.canSubmit || state.isSubmitting}>
                  {state.isSubmitting ? "Registering…" : "Register provider"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
