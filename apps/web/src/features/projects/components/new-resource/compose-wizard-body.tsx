/**
 * Inner chrome for the Compose wizard, built on `<form.FormGroup>`: one group
 * per step. The `file` group owns the source toggle + source-specific fields;
 * the `vars` group owns the `${VAR}` editor. Each group renders its OWN inner
 * `<form>` whose submit calls `group.handleSubmit()`, so validation is
 * per-step: the group runs its own `onDynamic` schema (compose-schema.ts) and
 * only fires `onGroupSubmit` when that step is valid. Split out of
 * compose-wizard.tsx to keep that file under the line caps.
 *
 * Nothing here hand-rolls validity: the footer button's disabled state reads
 * `group.state.meta.isValid` (field-level + group-level, so the inline
 * content field's async deployability verdict is already folded in), and the
 * vars banner reads the same. `source` is read straight off the form.
 */

import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useSelector } from "@tanstack/react-form";

import { Button } from "@/shared/components/ui/button";

import type { ComposeForm, Preview } from "./compose-wizard-shared";

import { fileStepSchema, varsStepSchema } from "./compose-schema";
import { ComposeGitFields, ComposeInlineFields } from "./compose-wizard-fields";

// The file-step button's label. Git has no vars step, so its file step stages
// directly ("Add resource"). Inline always routes through the vars step so env
// is reviewed BEFORE deploy: "Next: variables" when the file declares any,
// "Review & stage" when it declares none.
function fileStepLabel(source: "inline" | "git", hasVars: boolean, isPending: boolean): string {
  if (source === "git") return isPending ? "Adding…" : "Add resource";
  return hasVars ? "Next: variables" : "Review & stage";
}

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
            ? "The compose file references these: secrets are auto-generated, defaults pre-filled. "
            : "Set any variables this stack needs before it deploys. "}
          A red marker flags a required value that's still empty; click the eye to reveal or edit a
          secret. Saved as project variables.
        </span>
      </div>
      {requiredUnset && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Fill in the fields flagged in red: they're required and still empty. Secrets are already
          generated; what's left is usually a URL or name only you know.
        </div>
      )}
      <form.AppField name="vars.variables">
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

// The `file` step. The FormGroup's `onDynamic` is `fileStepSchema` (its input
// type IS the `file` slice, so no cast). `onGroupSubmit` fires only when that
// slice validates; the owner then either stages (git) or advances to vars.
function ComposeFileGroup({
  form,
  source,
  hasVars,
  isPending,
  onNext,
  onCancel,
  fields,
}: {
  form: ComposeForm;
  source: "inline" | "git";
  hasVars: boolean;
  isPending: boolean;
  onNext: (source: "inline" | "git") => void;
  onCancel?: () => void;
  fields: React.ReactNode;
}) {
  return (
    <form.FormGroup
      name="file"
      validators={{ onDynamic: fileStepSchema }}
      onGroupSubmit={({ value }) => onNext(value.source)}
    >
      {(group) => (
        <form
          className="flex h-full flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void group.handleSubmit();
          }}
          noValidate
        >
          <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
            <ComposeSourceToggle
              source={source}
              onSelect={(s) => form.setFieldValue("file.source", s)}
            />
            {fields}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" size="sm" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={!group.state.meta.isValid || isPending}>
              {fileStepLabel(source, hasVars, isPending)}
            </Button>
          </div>
        </form>
      )}
    </form.FormGroup>
  );
}

// The `vars` step. `onDynamic` is `varsStepSchema`; `onGroupSubmit` stages the
// stack once every required `${VAR}` is filled. The banner + disabled state
// both read the group's own validity, no hand-rolled "requiredUnset" boolean.
function ComposeVarsGroup({
  form,
  projectId,
  hasVars,
  isPending,
  onStage,
  onBack,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  hasVars: boolean;
  isPending: boolean;
  onStage: () => void;
  onBack: () => void;
}) {
  return (
    <form.FormGroup
      name="vars"
      validators={{ onDynamic: varsStepSchema }}
      onGroupSubmit={() => onStage()}
    >
      {(group) => (
        <form
          className="flex h-full flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void group.handleSubmit();
          }}
          noValidate
        >
          <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
            <ComposeVarsStep
              form={form}
              projectId={projectId}
              hasVars={hasVars}
              requiredUnset={!group.state.meta.isValid}
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" size="sm" type="button" onClick={onBack}>
              Back
            </Button>
            <Button size="sm" type="submit" disabled={!group.state.meta.isValid || isPending}>
              {isPending ? "Adding…" : "Add resource"}
            </Button>
          </div>
        </form>
      )}
    </form.FormGroup>
  );
}

export function ComposeWizardBody({
  form,
  step,
  projectId,
  projectSlug,
  parsing,
  preview,
  hasVars,
  isPending,
  onFileNext,
  onStage,
  onBack,
  onCancel,
  fileInput,
  editorRef,
  parseContent,
}: {
  form: ComposeForm;
  step: "file" | "vars";
  projectId: ProjectId;
  projectSlug: ProjectSlug;
  parsing: boolean;
  preview: Preview | null;
  hasVars: boolean;
  isPending: boolean;
  onFileNext: (source: "inline" | "git") => void;
  onStage: () => void;
  onBack: () => void;
  onCancel?: () => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
}) {
  // Read the source straight off the form: it drives which field group renders
  // inside the `file` step, and the owner reads the same store for it too.
  const source = useSelector(form.store, (s) => s.values.file.source);

  if (step === "vars") {
    return (
      <ComposeVarsGroup
        form={form}
        projectId={projectId}
        hasVars={hasVars}
        isPending={isPending}
        onStage={onStage}
        onBack={onBack}
      />
    );
  }

  const fields =
    source === "git" ? (
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
    );

  return (
    <ComposeFileGroup
      form={form}
      source={source}
      hasVars={hasVars}
      isPending={isPending}
      onNext={onFileNext}
      onCancel={onCancel}
      fields={fields}
    />
  );
}
