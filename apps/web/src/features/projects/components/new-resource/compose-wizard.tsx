/**
 * Dedicated create flow for Docker Compose stacks. Like every other resource,
 * compose now STAGES into the project manifest rather than deploying on submit:
 * paste/upload a compose file → the server parses it for a live preview
 * (`compose.parse`) → "Add resource" writes a `composes[name]` entry to the
 * manifest. The stack then shows on the graph as a pending ghost group, and the
 * pending-changes bar's Deploy (manifest.apply) provisions it. See
 * docs/designs/compose.md.
 *
 * The wizard chrome lives in ./compose-wizard-body (+ ./compose-wizard-fields,
 * ./compose-preview); shared types/helpers in ./compose-wizard-shared; the
 * parse hook in ./compose-wizard-parse; CodeMirror config in
 * ./compose-wizard-editor.
 */
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useEffect, useRef, useState } from "react";

import { useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";

import { useStageManifestChange } from "../../hooks/use-manifest-stage";
import { ComposeWizardBody } from "./compose-wizard-body";
import { useComposeParse } from "./compose-wizard-parse";
import {
  type ComposeFormValues,
  type ComposePrefill,
  deriveComposeFlags,
  toResourceName,
  useComposeForm,
} from "./compose-wizard-shared";

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
  // Latest blank-name fallback (repo/parsed stack name), kept in a ref so the
  // submit handler can read it without forward-referencing the derived value.
  const derivedNameRef = useRef("compose-stack");
  // Two-step inline flow: paste the file → fill its `${VAR}` values.
  const [step, setStep] = useState<"file" | "vars">("file");

  const stage = useStageManifestChange(projectId, {
    successToast: "Stack staged — review and click Deploy to apply",
  });

  const onSubmit = async (value: ComposeFormValues) => {
    // Stage a `composes[name]` entry into the manifest — no immediate deploy.
    // The graph then shows the stack as a pending ghost; the pending-changes
    // bar's Deploy provisions it (manifest.apply → reconciler).
    const rawName = value.name.trim() || derivedNameRef.current;
    const name = toResourceName(rawName);

    // `${VAR}` values → manifest env. Secret-ness is re-derived at apply time
    // from the key name (mirrors the create handler's default).
    const env: Record<string, string> = {};
    for (const v of value.variables) {
      if (v.key.trim() && v.value.trim()) env[v.key.trim()] = v.value;
    }
    const hasEnv = Object.keys(env).length > 0;

    const entry =
      value.source === "inline"
        ? {
            source: "inline" as const,
            content: value.content,
            // Multi-file: the compose file + supporting files. Only sent when the
            // user added files; a single-file stack keeps just `content`.
            ...(value.files.some((f) => f.path.trim())
              ? {
                  files: [
                    { path: "compose.yml", content: value.content },
                    ...value.files
                      .filter((f) => f.path.trim())
                      .map((f) => ({ path: f.path.trim(), content: f.content })),
                  ],
                  composePath: "compose.yml",
                }
              : {}),
            ...(hasEnv ? { env } : {}),
            exposed: value.exposed.map((k) => {
              const [service, port] = k.split(":");
              return { service: service ?? "", port: Number(port) };
            }),
          }
        : {
            source: "git" as const,
            // Bound repo id (private-capable) when picked; else the pasted URL.
            ...(value.gitRepoId.trim()
              ? { gitRepoId: value.gitRepoId.trim() }
              : { gitRepoUrl: value.gitRepoUrl.trim() }),
            ...(value.gitRef.trim() ? { gitRef: value.gitRef.trim() } : {}),
            // Blank → the builder auto-detects common compose file names.
            ...(value.composePath.trim() ? { composePath: value.composePath.trim() } : {}),
            ...(value.sourceSubdir.trim() ? { sourceSubdir: value.sourceSubdir.trim() } : {}),
            ...(hasEnv ? { env } : {}),
          };

    await stage.mutateAsync((current) => ({
      ...current,
      project: current.project || projectSlug,
      composes: { ...current.composes, [name]: entry },
    }));
    onComplete?.();
    void navigate({
      to: "/$orgSlug/$projectSlug/graph",
      params: { orgSlug, projectSlug },
    });
  };

  const form = useComposeForm(onSubmit);
  const { preview, parseContent } = useComposeParse(projectId, editorRef, form);

  // Template handoff: seed the form once on mount and run the same parse the
  // editor's onChange runs, so the preview + `${VAR}` rows populate exactly as
  // if the operator had pasted the file themselves.
  const prefillDone = useRef(false);
  useEffect(() => {
    if (!prefill || prefillDone.current) return;
    prefillDone.current = true;
    form.setFieldValue("name", prefill.name);
    form.setFieldValue("content", prefill.content);
    void parseContent(prefill.content);
  }, [prefill, form, parseContent]);

  const source = useStore(form.store, (s) => s.values.source);
  const gitRepoUrl = useStore(form.store, (s) => s.values.gitRepoUrl);
  const exposed = new Set(useStore(form.store, (s) => s.values.exposed));
  // The form already tracks the async `content` validation — no manual flag.
  const parsing = useStore(form.store, (s) => Boolean(s.fieldMeta.content?.isValidating));

  const toggleExpose = (key: string) => {
    const cur = form.state.values.exposed;
    form.setFieldValue("exposed", cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };

  const { buildServices, hasVars, showNext, canCreate, derivedName } = deriveComposeFlags({
    source,
    gitRepoUrl,
    preview,
    step,
    stagePending: stage.isPending,
  });
  // Keep the submit-time fallback name current without the handler closing over
  // the derived value (which would forward-reference it).
  useEffect(() => {
    derivedNameRef.current = derivedName;
  }, [derivedName]);

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        // Never create straight from the file step — a submit here (Enter key,
        // the Next button, anything) advances to the variables step instead, so
        // env is always reviewed before the stack is created + deployed.
        if (showNext) {
          setStep("vars");
          return;
        }
        void form.handleSubmit();
      }}
      noValidate
    >
      <ComposeWizardBody
        form={form}
        projectId={projectId}
        projectSlug={projectSlug}
        step={step}
        setStep={setStep}
        source={source}
        parsing={parsing}
        preview={preview}
        buildServices={buildServices}
        exposed={exposed}
        hasVars={hasVars}
        derivedName={derivedName}
        showNext={showNext}
        canCreate={canCreate}
        isPending={stage.isPending}
        onCancel={onCancel}
        fileInput={fileInput}
        editorRef={editorRef}
        parseContent={parseContent}
        onToggleExpose={toggleExpose}
      />
    </form>
  );
}
