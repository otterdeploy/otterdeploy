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
              <Field>
                <FieldLabel htmlFor={field.name}>Provider ID</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="okta"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Appears in the redirect URI you give your IdP. Cannot be changed later.
                </p>
                {field.state.meta.errors.map((error) => (
                  <FieldError key={error?.message}>{error?.message}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="domain">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Email domain</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="acme.com"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <FieldError key={error?.message}>{error?.message}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="issuer">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Issuer URL</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="https://acme.okta.com"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <FieldError key={error?.message}>{error?.message}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="clientId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Client ID</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <FieldError key={error?.message}>{error?.message}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="clientSecret">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Client secret</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Stored encrypted and never shown again. To rotate it, remove the provider and add
                  it back.
                </p>
                {field.state.meta.errors.map((error) => (
                  <FieldError key={error?.message}>{error?.message}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="discoveryEndpoint">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Discovery endpoint (optional)</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="https://acme.okta.com/.well-known/openid-configuration"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to derive it from the issuer.
                </p>
                {field.state.meta.errors.map((error) => (
                  <FieldError key={error?.message}>{error?.message}</FieldError>
                ))}
              </Field>
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
