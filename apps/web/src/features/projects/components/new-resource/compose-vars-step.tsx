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
      {/* One public address per exposed service, seeded with the host the
          server would generate, so leaving them alone changes nothing. There
          used to be a single box here: it was seeded from whichever service
          declared a port first (openstatus: its internal libsql) and applied
          only to the first exposed entry, so every other hostname was
          generated silently and could not be changed until after the deploy. */}
      <form.Subscribe selector={(st) => st.values.vars.domains}>
        {(domains) =>
          domains.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {t(domains.length > 1 ? "compose.domainsLabel" : "compose.domainLabel")}
                </span>
                <span className="text-xs text-muted-foreground">{t("compose.domainHelp")}</span>
              </div>
              {domains.map((row, i) => (
                <form.AppField key={row.key} name={`vars.domains[${i}].domain`}>
                  {(field) => (
                    <field.TextField
                      label={row.key.split(":")[0] ?? row.key}
                      placeholder={t("compose.domainPlaceholder")}
                    />
                  )}
                </form.AppField>
              ))}
            </div>
          ) : null
        }
      </form.Subscribe>
      <form.AppField
        name="vars.variables"
        validators={{ onChange: variablesValidatorFor(suggestions) }}
      >
        {(field) => <field.VariablesField projectId={projectId} suggestions={suggestions} />}
      </form.AppField>
    </div>
  );
}
