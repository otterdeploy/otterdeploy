/**
 * Inner chrome for the Compose wizard: the vars step, the source toggle, the
 * footer buttons, and the body that composes them with the source-specific
 * field groups. Split out of compose-wizard.tsx to keep that file under the
 * line caps.
 *
 * Nothing here hand-rolls validity: the owner passes `canContinue` (derived
 * from the compose schema) + a few display facts (`isLast` / `hasVars` /
 * `requiredUnset`). `step` and `source` are read straight off the form, so the
 * body doesn't need them threaded either.
 */

import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useStore } from "@tanstack/react-form";

import { Button } from "@/shared/components/ui/button";

import type { ComposeForm, Preview } from "./compose-wizard-shared";

import { ComposeGitFields, ComposeInlineFields } from "./compose-wizard-fields";

function ComposeVarsStep({
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
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Environment variables</span>
        <span className="text-xs text-muted-foreground">
          {hasVars
            ? "The compose file references these — secrets are auto-generated, defaults pre-filled. "
            : "Set any variables this stack needs before it deploys. "}
          A red marker flags a required value that's still empty; click the eye to reveal or edit a
          secret. Saved as project variables.
        </span>
      </div>
      {requiredUnset && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Fill in the fields flagged in red — they're required and still empty. Secrets are already
          generated; what's left is usually a URL or name only you know.
        </div>
      )}
      <form.AppField name="variables">
        {(field) => <field.VariablesField projectId={projectId} />}
      </form.AppField>
    </div>
  );
}

function ComposeSourceToggle({
  source,
  onSelect,
}: {
  source: "inline" | "git";
  onSelect: (s: "inline" | "git") => void;
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 p-0.5">
      {(["inline", "git"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className={
            source === s
              ? "rounded bg-background px-2.5 py-1 text-xs text-foreground shadow-sm"
              : "rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {s === "inline" ? "Paste file" : "From repo"}
        </button>
      ))}
    </div>
  );
}

// The "advance" button's label. Inline always routes through the vars step
// before staging (so env is reviewed BEFORE deploy) — "Next: variables" when
// the file declares any, "Review & stage" when it declares none. Git has no
// vars step, so its file-step button stages directly.
function advanceLabel(isLast: boolean, hasVars: boolean, isPending: boolean): string {
  if (isLast) return isPending ? "Adding…" : "Add resource";
  return hasVars ? "Next: variables" : "Review & stage";
}

function ComposeFooter({
  step,
  isLast,
  hasVars,
  canContinue,
  isPending,
  onBack,
  onCancel,
}: {
  step: "file" | "vars";
  isLast: boolean;
  hasVars: boolean;
  canContinue: boolean;
  isPending: boolean;
  onBack: () => void;
  onCancel?: () => void;
}) {
  if (step === "vars") {
    return (
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" size="sm" type="button" onClick={onBack}>
          Back
        </Button>
        <Button size="sm" type="submit" disabled={!canContinue}>
          {isPending ? "Adding…" : "Add resource"}
        </Button>
      </div>
    );
  }
  // File step. The button is `type="submit"` with NO onClick — the form's
  // onSubmit (handleContinue) owns both the file→vars transition and the git
  // create, so Enter and this button behave identically.
  return (
    <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
      <Button variant="outline" size="sm" type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" type="submit" disabled={!canContinue}>
        {advanceLabel(isLast, hasVars, isPending)}
      </Button>
    </div>
  );
}

export function ComposeWizardBody({
  form,
  projectId,
  projectSlug,
  parsing,
  preview,
  isLast,
  hasVars,
  requiredUnset,
  canContinue,
  isPending,
  onBack,
  onCancel,
  fileInput,
  editorRef,
  parseContent,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  projectSlug: ProjectSlug;
  parsing: boolean;
  preview: Preview | null;
  isLast: boolean;
  hasVars: boolean;
  requiredUnset: boolean;
  canContinue: boolean;
  isPending: boolean;
  onBack: () => void;
  onCancel?: () => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
}) {
  // Read the two view-driving values straight off the form — no need to thread
  // them from the owner, which reads the same store.
  const step = useStore(form.store, (s) => s.values.__step);
  const source = useStore(form.store, (s) => s.values.source);

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
        {step === "vars" ? (
          <ComposeVarsStep
            form={form}
            projectId={projectId}
            hasVars={hasVars}
            requiredUnset={requiredUnset}
          />
        ) : (
          <>
            <ComposeSourceToggle
              source={source}
              onSelect={(s) => {
                // Reset to the file step and switch source in one gesture — the
                // discriminator moves with the view it drives.
                form.setFieldValue("__step", "file");
                form.setFieldValue("source", s);
              }}
            />

            {source === "git" ? (
              <ComposeGitFields form={form} projectId={projectId} projectSlug={projectSlug} />
            ) : (
              <ComposeInlineFields
                form={form}
                projectId={projectId}
                fileInput={fileInput}
                editorRef={editorRef}
                parseContent={parseContent}
                parsing={parsing}
                preview={preview}
              />
            )}
          </>
        )}
      </div>

      <ComposeFooter
        step={step}
        isLast={isLast}
        hasVars={hasVars}
        canContinue={canContinue}
        isPending={isPending}
        onBack={onBack}
        onCancel={onCancel}
      />
    </>
  );
}
