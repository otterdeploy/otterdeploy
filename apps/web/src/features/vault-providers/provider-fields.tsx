/**
 * Field building blocks for the secret-provider dialog: one labelled text
 * field (same structural-field-API pattern as the SSO dialog) plus the
 * per-kind config field groups, split out so the dialog stays under the
 * function line cap.
 *
 * Descriptors carry i18n KEYS (`labelKey` / `hintKey`), resolved with `t()`
 * at the render site; placeholders are literal example values (URLs, slugs)
 * and stay untranslated.
 */

import type { TranslationKey } from "@otterdeploy/i18n";

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

/** All per-kind form field names, flat: the dialog assembles the per-kind
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
    labelKey: TranslationKey;
    placeholder?: string;
    hintKey?: TranslationKey;
  }>
> = {
  hashicorp: [
    {
      name: "url",
      labelKey: "vault.fields.vaultUrl",
      placeholder: "https://vault.example.com:8200",
    },
    { name: "mount", labelKey: "vault.fields.kvMount", placeholder: "secret" },
    {
      name: "namespace",
      labelKey: "vault.fields.namespaceOptional",
      hintKey: "vault.fields.namespaceHint",
    },
  ],
  infisical: [
    {
      name: "siteUrl",
      labelKey: "vault.fields.siteUrlOptional",
      placeholder: "https://app.infisical.com",
      hintKey: "vault.fields.siteUrlHint",
    },
    { name: "clientId", labelKey: "vault.fields.clientId" },
    { name: "projectId", labelKey: "vault.fields.projectId" },
    { name: "environmentSlug", labelKey: "vault.fields.environmentSlug", placeholder: "prod" },
    { name: "secretPath", labelKey: "vault.fields.secretPathOptional", placeholder: "/" },
  ],
  doppler: [
    {
      name: "dopplerProject",
      labelKey: "vault.fields.dopplerProjectOptional",
      hintKey: "vault.fields.dopplerProjectHint",
    },
    { name: "dopplerConfig", labelKey: "vault.fields.dopplerConfigOptional", placeholder: "prd" },
  ],
};

/** The credential's label key per kind: it's a different artifact per provider. */
export const CREDENTIAL_LABEL_KEYS: Record<ProviderFormValues["kind"], TranslationKey> = {
  hashicorp: "vault.credentials.hashicorp",
  infisical: "vault.credentials.infisical",
  doppler: "vault.credentials.doppler",
};
