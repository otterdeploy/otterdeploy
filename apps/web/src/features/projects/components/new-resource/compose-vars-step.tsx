/**
 * The Compose wizard's `vars` step body: the heading, the required-value
 * banner, and the variables editor itself. Split out of compose-wizard-body.tsx
 * to keep that file under the line cap; the FormGroup that owns validation and
 * the footer still lives there.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useTranslation } from "react-i18next";

import type { EnvSuggestion } from "@/features/resources/env-catalog";

import type { ComposeForm } from "./compose-wizard-shared";

import { ComposeDomainsField } from "./compose-domains-field";
import { variablesValidatorFor } from "./form-fields/variables-field";

export function ComposeVarsStep({
  form,
  projectId,
  hasVars,
  requiredUnset,
  suggestions = [],
}: {
  form: ComposeForm;
  projectId: ProjectId;
  hasVars: boolean;
  requiredUnset: boolean;
  /** Known variables for the stack's images — a template's `.env.schema`
   *  projected through the env-catalog. Drives key autocomplete and the
   *  per-row shape checks. */
  suggestions?: EnvSuggestion[];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t("compose.varsTitle")}</span>
        <span className="text-xs text-muted-foreground">
          {t(hasVars ? "compose.varsWithRefs" : "compose.varsNoRefs")} {t("compose.varsShared")}
        </span>
      </div>
      {requiredUnset && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t("compose.varsRequiredBanner")}
        </div>
      )}
      <ComposeDomainsField form={form} />
      <form.AppField
        name="vars.variables"
        validators={{ onChange: variablesValidatorFor(suggestions) }}
      >
        {(field) => <field.VariablesField projectId={projectId} suggestions={suggestions} />}
      </form.AppField>
    </div>
  );
}
