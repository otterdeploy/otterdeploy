/**
 * The Compose wizard's `vars` step body: the heading, the required-value
 * banner, and the variables editor itself. Split out of compose-wizard-body.tsx
 * to keep that file under the line cap; the FormGroup that owns validation and
 * the footer still lives there.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useTranslation } from "react-i18next";

import type { ComposeForm } from "./compose-wizard-shared";

import { noDuplicateKeysValidator } from "./form-fields/variables-field";

export function ComposeVarsStep({
  form,
  projectId,
  hasVars,
  requiredUnset,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  hasVars: boolean;
  requiredUnset: boolean;
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
      <form.AppField name="vars.variables" validators={{ onChange: noDuplicateKeysValidator }}>
        {(field) => <field.VariablesField projectId={projectId} />}
      </form.AppField>
    </div>
  );
}
