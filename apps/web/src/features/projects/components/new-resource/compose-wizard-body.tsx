/**
 * Inner chrome for the Compose wizard, built on `<form.FormGroup>`: one group
 * per step. The `file` group owns the source-specific fields (and the source
 * toggle, but only when no template prefilled the content: a template IS the
 * source, so the toggle would only offer a way to discard it). The `vars`
 * group owns the `${VAR}` editor, whose body is in ./compose-vars-step.
 *
 * Each group renders its OWN inner
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
import type { TFunction } from "i18next";

import { useSelector } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

import { envSuggestionsForImages, type EnvSuggestion } from "@/features/resources/env-catalog";
import { Button } from "@/shared/components/ui/button";

import type { ComposeForm, Preview } from "./compose-wizard-shared";

import { fileStepSchema, varsStepSchema } from "./compose-schema";
import { ComposeVarsStep } from "./compose-vars-step";
import {
  ComposeGitFields,
  ComposeInlineFields,
  ComposeSourceToggle,
} from "./compose-wizard-fields";

// The file-step button's label. Git has no vars step, so its file step stages
// directly ("Add resource"). Inline always routes through the vars step so env
// is reviewed BEFORE deploy: "Next: variables" when the file declares any,
// "Review & stage" when it declares none.
function fileStepLabel(
  t: TFunction,
  source: "inline" | "git",
  hasVars: boolean,
  isPending: boolean,
): string {
  if (source === "git") return t(isPending ? "compose.adding" : "compose.addResource");
  return t(hasVars ? "compose.nextVariables" : "compose.reviewStage");
}

// The `file` step. The FormGroup's `onDynamic` is `fileStepSchema` (its input
// type IS the `file` slice, so no cast). `onGroupSubmit` fires only when that
// slice validates; the owner then either stages (git) or advances to vars.
function ComposeFileGroup({
  form,
  source,
  hasVars,
  hasPrefill,
  isPending,
  onNext,
  onCancel,
  fields,
}: {
  form: ComposeForm;
  source: "inline" | "git";
  hasVars: boolean;
  hasPrefill: boolean;
  isPending: boolean;
  onNext: (source: "inline" | "git") => void;
  onCancel?: () => void;
  fields: React.ReactNode;
}) {
  const { t } = useTranslation();
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
            {/* A template IS the source. Offering "From repo" there is a dead
                end wearing a tab: clicking it discards the prefilled YAML and
                asks for a repo URL. The toggle is only a real choice when the
                operator arrived with no file. */}
            {hasPrefill ? null : (
              <ComposeSourceToggle
                source={source}
                onSelect={(s) => form.setFieldValue("file.source", s)}
              />
            )}
            {fields}
          </div>
          <div className="flex items-center gap-2 border-t px-5 py-3">
            {hasVars && source === "inline" ? (
              <span className="text-[11px] text-muted-foreground">
                {t("compose.step", { current: 1, total: 2 })}
              </span>
            ) : null}
            <div className="flex-1" />
            <Button variant="outline" size="sm" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" type="submit" disabled={!group.state.meta.isValid || isPending}>
              {fileStepLabel(t, source, hasVars, isPending)}
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
  suggestions,
  onStage,
  onBack,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  hasVars: boolean;
  isPending: boolean;
  /** Known variables for every image the parsed file runs. */
  suggestions: EnvSuggestion[];
  onStage: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
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
              suggestions={suggestions}
            />
          </div>
          <div className="flex items-center gap-2 border-t px-5 py-3">
            <span className="text-[11px] text-muted-foreground">
              {t("compose.step", { current: 2, total: 2 })}
            </span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" type="button" onClick={onBack}>
              {t("common.back")}
            </Button>
            <Button size="sm" type="submit" disabled={!group.state.meta.isValid || isPending}>
              {t(isPending ? "compose.adding" : "compose.addResource")}
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
  hasPrefill,
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
  /** A template seeded the compose content (the template handoff flow). */
  hasPrefill: boolean;
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
        // Every image the parsed file runs, so a template's `.env.schema`
        // (keyed by its app image) reaches the editor as autocomplete and
        // shape checks, and the bundled Postgres/Redis get the database
        // catalog's. Empty for a file that hasn't parsed yet.
        suggestions={envSuggestionsForImages(preview?.services.map((svc) => svc.image) ?? [])}
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
        hasPrefill={hasPrefill}
      />
    );

  return (
    <ComposeFileGroup
      form={form}
      source={source}
      hasVars={hasVars}
      hasPrefill={hasPrefill}
      isPending={isPending}
      onNext={onFileNext}
      onCancel={onCancel}
      fields={fields}
    />
  );
}
