/**
 * Bulk .env editor. TanStack Form owns the buffer + target selection (no
 * hand-rolled state), the localStorage-backed drafts collection keeps the
 * buffer alive across reloads, and submit state comes from the form's own
 * isSubmitting. The form BODY remounts each time the dialog opens (or a
 * dropped .env arrives) so defaults re-seed without prev-value juggling.
 */

import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  clearVariableDraft,
  setVariableDraft,
  variableDraftId,
  variableDraftsCollection,
} from "@/features/projects/data/variable-drafts";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";

import type { EnvironmentRef, EnvVarRow } from "./variables-types";

import { envLabel, runBulkApply } from "./variables-bulk-apply";
import { BulkEditSidebar } from "./variables-bulk-sidebar";
import { parseDotEnv } from "./variables-dotenv";

interface BulkEditProps {
  projectId: string;
  env: EnvironmentRef;
  /** Every env in the project: the cross-env "Apply to" targets. */
  allEnvs: EnvironmentRef[];
  currentRows: EnvVarRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the env ids that were successfully replaced. */
  onSaved: (envIds: string[]) => void;
  /** When set (drag-drop .env import), seeds the editor instead of the current rows. */
  prefillText?: string | null;
}

export function BulkEditDialog(props: BulkEditProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Keyed remount re-seeds the form's defaults on every open / env
          switch / dropped file: the render-time prev-value dance this
          replaces lived at the mercy of refetch timing. */}
      {props.open && <BulkEditBody key={`${props.env.id}:${props.prefillText ?? ""}`} {...props} />}
    </Dialog>
  );
}

function BulkEditBody({
  projectId,
  env,
  allEnvs,
  currentRows,
  onOpenChange,
  onSaved,
  prefillText,
}: BulkEditProps) {
  const { t } = useTranslation();
  const initial = currentRows.map((v) => `${v.key}=${v.value}`).join("\n");
  // A surviving draft outranks the saved rows: it's what the operator typed
  // before a reload ate the component state. An explicit .env drop outranks both.
  const storedDraft = variableDraftsCollection.get(variableDraftId(projectId, env.id));
  const restoredFromDraft = prefillText == null && storedDraft !== undefined;

  const form = useForm({
    defaultValues: {
      text: prefillText ?? storedDraft?.text ?? initial,
      targetIds: [env.id],
    },
    onSubmit: async ({ value }) => {
      const targets = allEnvs.filter((e) => value.targetIds.includes(e.id));
      if (targets.length === 0) return;
      const parsed = parseDotEnv(value.text);
      const { applied, failed } = await runBulkApply({
        projectId,
        targets,
        vars: parsed,
        fallbackMessage: t("variables.couldntSave"),
      });
      // The buffer is now the saved state for every applied env: their
      // drafts (including this editor's) would otherwise resurrect stale text.
      for (const target of applied) clearVariableDraft(projectId, target.id);
      if (applied.length > 0) onSaved(applied.map((e) => e.id));
      if (failed.length === 0) {
        onOpenChange(false);
        toast.success(
          t("variables.savedToast", {
            n: parsed.length,
            targets: targets.map(envLabel).join(", "),
          }),
        );
      } else {
        const suffix =
          applied.length > 0
            ? t("variables.appliedSuffix", { names: applied.map(envLabel).join(", ") })
            : "";
        toast.error(
          t("variables.failedToast", {
            names: failed.map((f) => envLabel(f.env)).join(", "),
            message: failed[0].message,
          }) + suffix,
        );
      }
    },
  });

  const setText = (next: string) => {
    form.setFieldValue("text", next);
    setVariableDraft({ projectId, environmentId: env.id, text: next, pristine: initial });
  };

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-4xl">
      <DialogHeader className="border-b px-5 py-3">
        <DialogTitle className="flex items-baseline gap-2 text-sm font-semibold">
          {t("variables.bulkTitle")}
          <span className="font-mono text-xs font-normal text-muted-foreground capitalize">
            · {envLabel(env)}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("variables.bulkSubtitle")}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-[1fr_280px] divide-x">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-[11px]">
            <span className="text-muted-foreground">{t("variables.dotenvHint")}</span>
            {restoredFromDraft && (
              <span className="flex items-center gap-1.5 text-warning">
                {t("variables.draftRestored")}
                <button
                  type="button"
                  className="underline decoration-warning/40 underline-offset-2 hover:decoration-warning"
                  onClick={() => {
                    clearVariableDraft(projectId, env.id);
                    form.setFieldValue("text", initial);
                  }}
                >
                  {t("variables.discardDraft")}
                </button>
              </span>
            )}
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() =>
                navigator.clipboard
                  ?.readText()
                  .then((clip) => setText(clip))
                  .catch(() => {})
              }
            >
              {t("variables.pasteClipboard")}
            </Button>
          </div>
          <form.Field name="text">
            {(field) => (
              <Textarea
                value={field.state.value}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className="min-h-[360px] resize-none rounded-none border-0 bg-muted/20 font-mono text-xs leading-7"
              />
            )}
          </form.Field>
        </div>

        <form.Subscribe selector={(s) => s.values}>
          {(values) => (
            <BulkEditSidebar
              allEnvs={allEnvs}
              targetIds={new Set(values.targetIds)}
              onToggleTarget={(envId) =>
                form.setFieldValue("targetIds", (prev) =>
                  prev.includes(envId) ? prev.filter((id) => id !== envId) : [...prev, envId],
                )
              }
              parsed={parseDotEnv(values.text)}
            />
          )}
        </form.Subscribe>
      </div>

      <form.Subscribe
        selector={(s) => ({
          values: s.values,
          isSubmitting: s.isSubmitting,
        })}
      >
        {({ values, isSubmitting }) => (
          <BulkEditFooter
            targets={allEnvs.filter((e) => values.targetIds.includes(e.id))}
            parsedCount={parseDotEnv(values.text).length}
            isSubmitting={isSubmitting}
            onCancel={() => onOpenChange(false)}
            onSubmit={() => void form.handleSubmit()}
          />
        )}
      </form.Subscribe>
    </DialogContent>
  );
}

function BulkEditFooter({
  targets,
  parsedCount,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  targets: EnvironmentRef[];
  parsedCount: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-t px-4 py-3">
      <span className="text-[11px] text-muted-foreground">
        {targets.length === 0
          ? t("variables.selectAtLeastOne")
          : t("variables.replacesIn", { targets: targets.map(envLabel).join(", ") })}
      </span>
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
      <Button size="sm" disabled={isSubmitting || targets.length === 0} onClick={onSubmit}>
        {isSubmitting
          ? t("common.saving")
          : targets.length > 1
            ? t("variables.applyVarsMulti", { n: parsedCount, envs: targets.length })
            : t("variables.applyVars", { n: parsedCount })}
      </Button>
    </div>
  );
}
