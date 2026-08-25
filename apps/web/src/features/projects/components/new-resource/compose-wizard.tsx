/**
 * Dedicated create flow for Docker Compose stacks. Like every other resource,
 * compose now STAGES into the project manifest rather than deploying on submit:
 * paste/upload a compose file → the server parses it for a live preview
 * (`compose.parse`) → "Add resource" writes a `composes[name]` entry to the
 * manifest. The stack then shows on the graph as a pending ghost group, and the
 * pending-changes bar's Deploy (manifest.apply) provisions it. See
 * docs/designs/compose.md.
 *
 * Validation is schema-owned via the `<form.FormGroup>` API: the form value is
 * nested into two groups (`file`, `vars`), and each step's FormGroup validates
 * its own slice with a per-step zod schema (./compose-schema.ts). There are no
 * hand-rolled `deriveComposeFlags` booleans and no prefill effect: the template
 * seeds through `defaultValues`, the parse runs off the content field's
 * `onMount` listener (compose-wizard-fields.tsx). The only React state is which
 * group renders; the FormGroups own every "can this step advance?" decision.
 *
 * The wizard chrome lives in ./compose-wizard-body (+ ./compose-wizard-fields,
 * ./compose-vars-step, ./compose-preview, ./compose-file-panel); shared
 * types/the form hook in ./compose-wizard-shared; the parse hook in
 * ./compose-wizard-parse; CodeMirror config in ./compose-wizard-editor.
 *
 * Layout is services-first: ComposePreview renders the parsed service list
 * above ComposeFilePanel, which folds the file itself behind a disclosure
 * whenever a template supplied it. `hasPrefill` is the one flag that says
 * "the operator did not write this file", and it drives both.
 */
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useRef, useState } from "react";

import { omitUndefined } from "@otterdeploy/shared/object";
import { useSelector } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";

import { useStageManifestChange } from "../../hooks/use-manifest-stage";
import { type ComposeFileValues, type ComposeStep, stackNamePlaceholder } from "./compose-schema";
import { ComposeWizardBody } from "./compose-wizard-body";
import { useComposeParse } from "./compose-wizard-parse";
import {
  type ComposeFormValues,
  type ComposePrefill,
  useComposeForm,
} from "./compose-wizard-shared";
import { editedExposedHost } from "./exposed-host";
import { useUniqueStackName } from "./use-unique-stack-name";

// Manifest `composes[name]` entry from the form values: split from the
// submit handler (and per source, inline vs git) to stay under the
// complexity cap.
function buildComposeEntry(value: ComposeFormValues, logoBrand: string | undefined) {
  // `${VAR}` values → manifest env. Secret-ness is re-derived at apply time
  // from the key name (mirrors the create handler's default).
  const env: Record<string, string> = {};
  for (const v of value.vars.variables) {
    if (v.key.trim() && v.value.trim()) env[v.key.trim()] = v.value;
  }
  // Template brand mark, persisted so the graph node shows the logo.
  const brand = logoBrand ? { logoBrand } : {};
  const envEntry = Object.keys(env).length > 0 ? { env } : {};
  const file = value.file;
  return file.source === "inline"
    ? buildInlineEntry(file, brand, envEntry, editedExposedHost(value.vars.variables))
    : buildGitEntry(file, brand, envEntry);
}

function buildInlineEntry(
  file: ComposeFileValues,
  brand: { logoBrand?: string },
  envEntry: { env?: Record<string, string> },
  /** Operator-edited public host for the front (first exposed) service. */
  exposedHost: string | null,
) {
  return {
    source: "inline" as const,
    ...brand,
    content: file.content,
    // Multi-file: the compose file + supporting files. Only sent when the
    // user added files; a single-file stack keeps just `content`.
    ...(file.files.some((f) => f.path.trim())
      ? {
          files: [
            { path: "compose.yml", content: file.content },
            ...file.files.flatMap((f) => {
              const path = f.path.trim();
              return path
                ? [
                    omitUndefined({
                      path,
                      content: f.content,
                      interpolate: f.interpolate || undefined,
                    }),
                  ]
                : [];
            }),
          ],
          composePath: "compose.yml",
        }
      : {}),
    ...envEntry,
    // The first exposed entry is the stack's front door (the same rule that
    // picked the host the address vars were seeded from), so an edited
    // address lands on it.
    exposed: file.exposed.map((k, i) => {
      const [service, port] = k.split(":");
      return {
        service: service ?? "",
        port: Number(port),
        ...(i === 0 && exposedHost ? { domain: exposedHost } : {}),
      };
    }),
  };
}

function buildGitEntry(
  file: ComposeFileValues,
  brand: { logoBrand?: string },
  envEntry: { env?: Record<string, string> },
) {
  const gitRepoId = file.gitRepoId.trim();
  return omitUndefined({
    source: "git" as const,
    logoBrand: brand.logoBrand,
    // Bound repo id (private-capable) when picked; else the pasted URL.
    gitRepoId: gitRepoId || undefined,
    gitRepoUrl: gitRepoId ? undefined : file.gitRepoUrl.trim(),
    // Blank → the builder auto-detects common compose file names.
    gitRef: file.gitRef.trim() || undefined,
    composePath: file.composePath.trim() || undefined,
    sourceSubdir: file.sourceSubdir.trim() || undefined,
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

  // The ONLY React state: which FormGroup renders. Every validity decision lives
  // in the groups themselves. Inline flows file → vars; git stages from `file`.
  const [step, setStep] = useState<ComposeStep>("file");

  // Template prefill is seeded through defaultValues (no effect). See
  // useComposeForm; the content field's onMount runs the initial parse.
  const form = useComposeForm(prefill);
  const { preview, parseContent } = useComposeParse(projectId, editorRef, form, prefill?.generate);

  // View facts read straight off the form store, no hand-rolled flags. `source`
  // and `gitRepoUrl`/`name` drive the derived name; `hasVars` decides whether
  // the file step routes through the vars step or (with no vars) straight to it.
  const source = useSelector(form.store, (s) => s.values.file.source);
  const gitRepoUrl = useSelector(form.store, (s) => s.values.file.gitRepoUrl);
  const name = useSelector(form.store, (s) => s.values.file.name);
  // On the inline file step the button also waits out the async content parse
  // (the deployability verdict lands as a field error the group folds into its
  // own validity). While that parse is in flight the content field validates.
  const parsing = useSelector(form.store, (s) =>
    Boolean(s.fieldMeta["file.content"]?.isValidating),
  );
  const hasVars = source === "inline" && (preview?.vars.length ?? 0) > 0;

  // What the name will be if left blank. The field placeholder and the base
  // useUniqueStackName bumps on collision.
  const derivedName = stackNamePlaceholder(source, gitRepoUrl, preview?.name);
  const unique = useUniqueStackName(projectId, name, derivedName);

  // Stage a `composes[name]` entry into the manifest, no immediate deploy. The
  // graph then shows the stack as a pending ghost; the pending-changes bar's
  // Apply provisions it (manifest.apply → reconciler).
  //
  // Fire-and-forget: close and navigate to the graph THIS FRAME instead of
  // awaiting the manifest.save round-trip. The dialog must not sit open on a
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

  // The file group's `onGroupSubmit`, fired only when the file slice validates:
  // git has no vars step so it stages directly; inline advances to review env.
  const handleFileNext = (fileSource: "inline" | "git") => {
    if (fileSource === "git") stageStack();
    else setStep("vars");
  };

  return (
    <ComposeWizardBody
      form={form}
      step={step}
      projectId={projectId}
      projectSlug={projectSlug}
      parsing={parsing}
      preview={preview}
      hasVars={hasVars}
      hasPrefill={Boolean(prefill)}
      isPending={stage.isPending}
      onFileNext={handleFileNext}
      onStage={stageStack}
      onBack={() => setStep("file")}
      onCancel={onCancel}
      fileInput={fileInput}
      editorRef={editorRef}
      parseContent={parseContent}
    />
  );
}
