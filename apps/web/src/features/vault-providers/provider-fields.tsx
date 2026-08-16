/**
 * Field building blocks for the secret-provider dialog — one labelled text
 * field (same structural-field-API pattern as the SSO dialog) plus the
 * per-kind config field groups, split out so the dialog stays under the
 * function line cap.
 */

import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";

/** The TanStack field API for a string-valued field, kept structural so the
 *  whole form shape doesn't need threading through. */
export interface StringFieldApi {
  name: string;
  state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
  handleBlur: () => void;
  handleChange: (value: string) => void;
}

export function ProviderTextField({
  field,
  label,
  placeholder,
  hint,
  type,
}: {
  field: StringFieldApi;
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

/** All per-kind form field names, flat — the dialog assembles the per-kind
 *  config object at submit time. */
export interface ProviderFormValues {
  kind: "hashicorp" | "infisical" | "doppler";
  name: string;
  credential: string;
  url: string;
  mount: string;
  namespace: string;
  siteUrl: string;
  clientId: string;
  projectId: string;
  environmentSlug: string;
  secretPath: string;
  dopplerProject: string;
  dopplerConfig: string;
}

/** Which per-kind field descriptors to render. Keys index ProviderFormValues. */
export const KIND_FIELDS: Record<
  ProviderFormValues["kind"],
  Array<{
    name: keyof Omit<ProviderFormValues, "kind">;
    label: string;
    placeholder?: string;
    hint?: string;
  }>
> = {
  hashicorp: [
    { name: "url", label: "Vault URL", placeholder: "https://vault.example.com:8200" },
    { name: "mount", label: "KV v2 mount", placeholder: "secret" },
    {
      name: "namespace",
      label: "Namespace (optional)",
      hint: "Vault Enterprise / HCP only (X-Vault-Namespace).",
    },
  ],
  infisical: [
    {
      name: "siteUrl",
      label: "Site URL (optional)",
      placeholder: "https://app.infisical.com",
      hint: "Leave blank for Infisical Cloud.",
    },
    { name: "clientId", label: "Machine identity client ID" },
    { name: "projectId", label: "Project ID" },
    { name: "environmentSlug", label: "Environment slug", placeholder: "prod" },
    { name: "secretPath", label: "Secret path (optional)", placeholder: "/" },
  ],
  doppler: [
    {
      name: "dopplerProject",
      label: "Project (optional)",
      hint: "Only needed when the service token isn't scoped to one config.",
    },
    { name: "dopplerConfig", label: "Config (optional)", placeholder: "prd" },
  ],
};

/** The credential's label per kind — it's a different artifact per provider. */
export const CREDENTIAL_LABELS: Record<ProviderFormValues["kind"], string> = {
  hashicorp: "Vault token",
  infisical: "Machine identity client secret",
  doppler: "Service token",
};
