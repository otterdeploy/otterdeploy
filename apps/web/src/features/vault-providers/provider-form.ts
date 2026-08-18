/**
 * Form logic for the secret-provider dialog: defaults, the zod schema and
 * the flat-form → discriminated-payload assembly. Split from
 * `provider-dialog.tsx` so that component stays a dialog shell within the
 * file-size budget.
 */

import type { TranslationKey } from "@otterdeploy/i18n";

import { omitUndefined } from "@otterdeploy/shared/object";
import * as z from "zod";

import type { ProviderFormValues } from "./provider-fields";

import { type VaultProvider, type VaultProviderKind } from "./data/vault-providers";

/** Mirrors the contract's name regex: the token grammar's provider slug. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const KINDS: VaultProviderKind[] = ["hashicorp", "infisical", "doppler"];

const EMPTY_FORM: ProviderFormValues = {
  kind: "hashicorp",
  name: "",
  credential: "",
  url: "",
  mount: "secret",
  namespace: "",
  siteUrl: "",
  clientId: "",
  projectId: "",
  environmentSlug: "",
  secretPath: "",
  dopplerProject: "",
  dopplerConfig: "",
};

export function defaultsFor(editing: VaultProvider | null): ProviderFormValues {
  if (!editing) return { ...EMPTY_FORM };
  // The config bag's keys line up with the flat form field names by design;
  // omitUndefined keeps blanks at their EMPTY_FORM defaults.
  return {
    ...EMPTY_FORM,
    ...omitUndefined(editing.config),
    kind: editing.kind,
    name: editing.name,
  };
}

/** Per-kind required fields beyond `name` (+ credential when creating). */
export function formSchema(isEdit: boolean, t: (key: TranslationKey) => string) {
  const required = t("vault.validationRequired");
  return z
    .object({
      kind: z.enum(["hashicorp", "infisical", "doppler"]),
      name: z.string().min(1, required).regex(NAME_PATTERN, t("vault.validationNamePattern")),
      credential: isEdit ? z.string() : z.string().min(1, required),
      url: z.string(),
      mount: z.string(),
      namespace: z.string(),
      siteUrl: z.string(),
      clientId: z.string(),
      projectId: z.string(),
      environmentSlug: z.string(),
      secretPath: z.string(),
      dopplerProject: z.string(),
      dopplerConfig: z.string(),
    })
    .superRefine((v, ctx) => {
      const require = (path: keyof ProviderFormValues, ok: boolean) => {
        if (!ok) ctx.addIssue({ code: "custom", path: [path], message: required });
      };
      if (v.kind === "hashicorp") require("url", v.url.trim().length > 0);
      if (v.kind === "infisical") {
        require("clientId", v.clientId.trim().length > 0);
        require("projectId", v.projectId.trim().length > 0);
        require("environmentSlug", v.environmentSlug.trim().length > 0);
      }
    });
}

const opt = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);

/** Assemble the discriminated create payload from the flat form values. */
export function toCreateInput(v: ProviderFormValues) {
  const name = v.name.trim();
  if (v.kind === "hashicorp") {
    return {
      kind: "hashicorp" as const,
      name,
      config: { url: v.url.trim(), mount: v.mount.trim() || "secret", namespace: opt(v.namespace) },
      credential: v.credential,
    };
  }
  if (v.kind === "infisical") {
    return {
      kind: "infisical" as const,
      name,
      config: {
        siteUrl: opt(v.siteUrl),
        clientId: v.clientId.trim(),
        projectId: v.projectId.trim(),
        environmentSlug: v.environmentSlug.trim(),
        secretPath: opt(v.secretPath),
      },
      credential: v.credential,
    };
  }
  return {
    kind: "doppler" as const,
    name,
    config: { dopplerProject: opt(v.dopplerProject), dopplerConfig: opt(v.dopplerConfig) },
    credential: v.credential,
  };
}
