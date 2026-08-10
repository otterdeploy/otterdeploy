/**
 * Dedicated create flow for Docker Compose stacks. Like every other resource,
 * compose now STAGES into the project manifest rather than deploying on submit:
 * paste/upload a compose file → the server parses it for a live preview
 * (`compose.parse`) → "Add resource" writes a `composes[name]` entry to the
 * manifest. The stack then shows on the graph as a pending ghost group, and the
 * pending-changes bar's Deploy (manifest.apply) provisions it. See
 * docs/designs/compose.md.
 *
 * Validation is schema-owned, like the sibling resource wizard: a zod
 * discriminated union keyed on `__step` (./compose-schema.ts) decides whether
 * each step can advance. There are no hand-rolled `deriveComposeFlags` booleans
 * and no prefill effect — the template seeds through `defaultValues`, the parse
 * runs off the content field's `onMount` listener (compose-wizard-fields.tsx).
 *
 * The wizard chrome lives in ./compose-wizard-body (+ ./compose-wizard-fields,
 * ./compose-preview); shared types/the form hook in ./compose-wizard-shared;
 * the parse hook in ./compose-wizard-parse; CodeMirror config in
 * ./compose-wizard-editor.
 */
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useRef } from "react";

import { omitUndefined } from "@otterdeploy/shared/object";
import { useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";

import { useStageManifestChange } from "../../hooks/use-manifest-stage";
import { composeFormSchema, stackNamePlaceholder, type ComposeStep } from "./compose-schema";
import { ComposeWizardBody } from "./compose-wizard-body";
import { useComposeParse } from "./compose-wizard-parse";
import { type ComposeFormValues, type ComposePrefill, useComposeForm } from "./compose-wizard-shared";
import { useUniqueStackName } from "./use-unique-stack-name";

// Manifest `composes[name]` entry from the form values — split from the
// submit handler (and per source, inline vs git) to stay under the
// complexity cap.
function buildComposeEntry(value: ComposeFormValues, logoBrand: string | undefined) {
  // `${VAR}` values → manifest env. Secret-ness is re-derived at apply time
  // from the key name (mirrors the create handler's default).
  const env: Record<string, string> = {};
  for (const v of value.variables) {
    if (v.key.trim() && v.value.trim()) env[v.key.trim()] = v.value;
  }
  // Template brand mark — persisted so the graph node shows the logo.
  const brand = logoBrand ? { logoBrand } : {};
  const envEntry = Object.keys(env).length > 0 ? { env } : {};
  return value.source === "inline"
    ? buildInlineEntry(value, brand, envEntry)
    : buildGitEntry(value, brand, envEntry);
}

function buildInlineEntry(
  value: ComposeFormValues,
  brand: { logoBrand?: string },
  envEntry: { env?: Record<string, string> },
) {
  return {
    source: "inline" as const,
    ...brand,
    content: value.content,
    // Multi-file: the compose file + supporting files. Only sent when the
    // user added files; a single-file stack keeps just `content`.
    ...(value.files.some((f) => f.path.trim())
      ? {
          files: [
            { path: "compose.yml", content: value.content },
            ...value.files.flatMap((f) =>
              f.path.trim() ? [{ path: f.path.trim(), content: f.content }] : [],
            ),
          ],
          composePath: "compose.yml",
        }
      : {}),
    ...envEntry,
    exposed: value.exposed.map((k) => {
      const [service, port] = k.split(":");
      return { service: service ?? "", port: Number(port) };
    }),
  };
}

function buildGitEntry(
  value: ComposeFormValues,
  brand: { logoBrand?: string },
  envEntry: { env?: Record<string, string> },
) {
  const gitRepoId = value.gitRepoId.trim();
  return omitUndefined({
    source: "git" as const,
    logoBrand: brand.logoBrand,
    // Bound repo id (private-capable) when picked; else the pasted URL.
    gitRepoId: gitRepoId || undefined,
    gitRepoUrl: gitRepoId ? undefined : value.gitRepoUrl.trim(),
    // Blank → the builder auto-detects common compose file names.
    gitRef: value.gitRef.trim() || undefined,
    composePath: value.composePath.trim() || undefined,
    sourceSubdir: value.sourceSubdir.trim() || undefined,
    env: envEntry.env,
  });
}

export function ComposeWizard({
  orgSlug,
  projectId,
  projectSlug,
  prefill,
  onComplete,
  onCancel,
}: {
  orgSlug: string;
  projectId: ProjectId;
  projectSlug: ProjectSlug;
  /** Template handoff: seeds name + compose content on mount, then runs the
   *  normal parse → preview → variables flow. See features/templates/. */
  prefill?: ComposePrefill;
  onComplete?: () => void;
  onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const stage = useStageManifestChange(projectId);

  // Template prefill is seeded through defaultValues (no effect) — see
  // useComposeForm; the content field's onMount runs the initial parse.
  const form = useComposeForm(prefill);
  const { preview, parseContent } = useComposeParse(projectId, editorRef, form);

  // Everything the chrome needs, derived from form state + the schema — no
  // hand-rolled flags. `values` re-renders the wizard on any field change,
  // which is exactly when a step's validity can flip.
  const values = useStore(form.store, (s) => s.values);
  const parsing = useStore(form.store, (s) => Boolean(s.fieldMeta.content?.isValidating));
  const contentInvalid = useStore(form.store, (s) => (s.fieldMeta.content?.errors?.length ?? 0) > 0);

  const step = values.__step;
  const source = values.source;
  // The schema arm for the CURRENT step: does it parse clean?
  const stepValid = composeFormSchema.safeParse(values).success;
  // Inline flows file → vars; git has only the file step.
  const steps: ComposeStep[] = source === "git" ? ["file"] : ["file", "vars"];
  const isLast = steps.indexOf(step) === steps.length - 1;
  // On the inline file step the schema only proves content is non-empty; whether
  // it's DEPLOYABLE (parsed clean, no `build:` service) is the async content
  // validator's verdict, read here off the field's own validity.
  const inlineFileGate = step === "file" && source === "inline" ? !parsing && !contentInvalid : true;
  const canContinue = !stage.isPending && stepValid && inlineFileGate;
  const hasVars = source === "inline" && (preview?.vars.length ?? 0) > 0;
  // The vars arm's only failure is an unset required `${VAR}` — so an invalid
  // vars step IS "something required is still blank", which drives the banner.
  const requiredUnset = step === "vars" && !stepValid;

  // What the name will be if left blank — the field placeholder and the base
  // useUniqueStackName bumps on collision.
  const derivedName = stackNamePlaceholder(source, values.gitRepoUrl, preview?.name);
  const unique = useUniqueStackName(projectId, values.name, derivedName);

  const goToStep = (next: ComposeStep) => form.setFieldValue("__step", next);

  // Stage a `composes[name]` entry into the manifest — no immediate deploy. The
  // graph then shows the stack as a pending ghost; the pending-changes bar's
  // Apply provisions it (manifest.apply → reconciler).
  //
  // Fire-and-forget: close and navigate to the graph THIS FRAME instead of
  // awaiting the manifest.save round-trip — the dialog must not sit open on a
  // network call. The stage mutation runs in the background; its onSuccess
  // invalidates the graph's diff/resource queries so the pending ghost appears
  // on arrival, and its onError toasts if the save fails.
  const stageStack = () => {
    const value = form.state.values;
    const entry = buildComposeEntry(value, prefill?.logoBrand);

    stage.mutate((current) => ({
      ...current,
      project: current.project || projectSlug,
      composes: { ...current.composes, [unique.name]: entry },
    }));
    onComplete?.();
    void navigate({
      to: "/$orgSlug/$projectSlug/graph",
      params: { orgSlug, projectSlug },
    });
  };

  // Validate the current step's arm, then advance or stage. Mirrors the resource
  // wizard's handleContinue — form.validate + getAllErrors, not booleans. The
  // `parsing` guard covers the async content parse still settling; the footer
  // button is already disabled via `canContinue`, so this mostly guards Enter.
  const handleContinue = async () => {
    await form.validate("change");
    const all = form.getAllErrors();
    const blocked =
      all.form.errors.length > 0 || Object.values(all.fields).some((f) => f.errors.length > 0);
    if (blocked || parsing || stage.isPending) return;
    if (isLast) stageStack();
    else goToStep("vars");
  };

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void handleContinue();
      }}
      noValidate
    >
      <ComposeWizardBody
        form={form}
        projectId={projectId}
        projectSlug={projectSlug}
        parsing={parsing}
        preview={preview}
        isLast={isLast}
        hasVars={hasVars}
        requiredUnset={requiredUnset}
        canContinue={canContinue}
        isPending={stage.isPending}
        onBack={() => goToStep("file")}
        onCancel={onCancel}
        fileInput={fileInput}
        editorRef={editorRef}
        parseContent={parseContent}
      />
    </form>
  );
}
