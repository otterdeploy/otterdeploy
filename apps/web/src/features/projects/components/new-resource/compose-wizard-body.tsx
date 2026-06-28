/**
 * Inner chrome for the Compose wizard: the vars step, the source toggle, the
 * footer buttons, and the body that composes them with the source-specific
 * field groups. Split out of compose-wizard.tsx to keep that file under the
 * line caps.
 */

import type { ProjectId } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { Button } from "@/shared/components/ui/button";

import type { ComposeForm, DetectedService, Preview } from "./compose-wizard-shared";

import { ComposeGitFields, ComposeInlineFields } from "./compose-wizard-fields";

function ComposeVarsStep({
  form,
  projectId,
  hasVars,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  hasVars: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Environment variables</span>
        <span className="text-xs text-muted-foreground">
          {hasVars
            ? "The compose file references these — defaults are pre-filled. "
            : "Set any variables this stack needs before it deploys. "}
          Edit, add more, or toggle the lock to mark a value secret. Saved as project variables.
        </span>
      </div>
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

function ComposeFooter({
  step,
  setStep,
  showNext,
  canCreate,
  isPending,
  onCancel,
}: {
  step: "file" | "vars";
  setStep: (s: "file" | "vars") => void;
  showNext: boolean;
  canCreate: boolean;
  isPending: boolean;
  onCancel?: () => void;
}) {
  if (step === "vars") {
    return (
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" size="sm" type="button" onClick={() => setStep("file")}>
          Back
        </Button>
        <Button size="sm" type="submit" disabled={!canCreate}>
          {isPending ? "Adding…" : "Add resource"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
      <Button variant="outline" size="sm" type="button" onClick={onCancel}>
        Cancel
      </Button>
      {showNext ? (
        <Button size="sm" type="button" onClick={() => setStep("vars")}>
          Next: variables
        </Button>
      ) : (
        <Button size="sm" type="submit" disabled={!canCreate}>
          {isPending ? "Adding…" : "Add resource"}
        </Button>
      )}
    </div>
  );
}

export function ComposeWizardBody({
  form,
  projectId,
  step,
  setStep,
  source,
  parsing,
  preview,
  buildServices,
  exposed,
  hasVars,
  derivedName,
  showNext,
  canCreate,
  isPending,
  onCancel,
  fileInput,
  editorRef,
  parseContent,
  onToggleExpose,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  step: "file" | "vars";
  setStep: (s: "file" | "vars") => void;
  source: "inline" | "git";
  parsing: boolean;
  preview: Preview | null;
  buildServices: DetectedService[];
  exposed: Set<string>;
  hasVars: boolean;
  derivedName: string;
  showNext: boolean;
  canCreate: boolean;
  isPending: boolean;
  onCancel?: () => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
  onToggleExpose: (key: string) => void;
}) {
  return (
    <>
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
        {step === "vars" ? (
          <ComposeVarsStep form={form} projectId={projectId} hasVars={hasVars} />
        ) : (
          <>
            <ComposeSourceToggle
              source={source}
              onSelect={(s) => {
                setStep("file");
                form.setFieldValue("source", s);
              }}
            />

            {source === "git" ? (
              <ComposeGitFields form={form} derivedName={derivedName} />
            ) : (
              <ComposeInlineFields
                form={form}
                derivedName={derivedName}
                fileInput={fileInput}
                editorRef={editorRef}
                parseContent={parseContent}
                parsing={parsing}
                preview={preview}
                buildServices={buildServices}
                exposed={exposed}
                onToggleExpose={onToggleExpose}
              />
            )}
          </>
        )}
      </div>

      <ComposeFooter
        step={step}
        setStep={setStep}
        showNext={showNext}
        canCreate={canCreate}
        isPending={isPending}
        onCancel={onCancel}
      />
    </>
  );
}
