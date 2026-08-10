/**
 * Source-specific field groups for the Compose wizard: the git-source inputs
 * and the inline file editor + preview. Split out of compose-wizard.tsx to keep
 * that file under the line caps. The optional stack-name field lives in
 * ./compose-name-field.
 *
 * Each group derives its own placeholder name from what it already has (git:
 * the repo URL; inline: the parsed `name:`).
 */

import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useMemo } from "react";

import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-form";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import type { ComposeForm, Preview } from "./compose-wizard-shared";

import { ComposeFileField } from "./compose-detect";
import { ComposeExtraFiles } from "./compose-extra-files";
import { ComposeNameField } from "./compose-name-field";
import { ComposePreview } from "./compose-preview";
import { stackNamePlaceholder } from "./compose-schema";
import { editorExtensions } from "./compose-wizard-editor";
import { RepoPicker } from "./steps/repo-picker";
import { useBindingSummary } from "./steps/source-binding";
import { BranchPicker } from "./steps/source-pickers";

export function ComposeGitFields({
  form,
  projectId,
  projectSlug,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  projectSlug: ProjectSlug;
}) {
  // Same repo-selection surface git services use: an account/repo picker over
  // the connected GitHub App installations (private-capable). `gitRepoId` bound
  // → clone via the installation token; a pasted public URL is the fallback.
  // `bindingProjectId` (string | null) is the one RepoPicker/PublicRepoCTA want;
  // the branded `projectId` prop is what useUniqueStackName needs.
  const { installations, projectId: bindingProjectId, hasInstallations } =
    useBindingSummary(projectSlug);
  const gitRepoId = useStore(form.store, (s) => s.values.file.gitRepoId);
  const gitRepoUrl = useStore(form.store, (s) => s.values.file.gitRepoUrl);
  const repoFullName = useStore(form.store, (s) => s.values.file.repoFullName);
  // Placeholder name for a blank field: the repo URL's last path segment.
  const derivedName = stackNamePlaceholder("git", gitRepoUrl, null);

  return (
    <>
      {hasInstallations ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Repository</span>
          <RepoPicker
            installations={installations}
            projectId={bindingProjectId}
            onBound={(repoId, fullName) => {
              form.setFieldValue("file.gitRepoId", repoId);
              form.setFieldValue("file.repoFullName", fullName);
              // Bound repo wins over any pasted URL.
              form.setFieldValue("file.gitRepoUrl", "");
            }}
          />
          {repoFullName ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              Selected: {repoFullName}
            </span>
          ) : null}
        </div>
      ) : null}

      {gitRepoId ? null : (
        <form.Field name="file.gitRepoUrl">
          {(field) => (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {hasInstallations ? "Or public repo URL" : "Repository URL"}
              </span>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="font-mono"
              />
            </label>
          )}
        </form.Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form.Field name="file.gitRef">
          {(field) => (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Branch</span>
              {gitRepoId ? (
                <BranchPicker
                  gitRepoId={gitRepoId}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              ) : (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="main"
                  className="font-mono"
                />
              )}
            </label>
          )}
        </form.Field>
        <ComposeFileField form={form} />
      </div>

      <form.Field name="file.sourceSubdir">
        {(field) => (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Root directory <span className="text-muted-foreground/60">(optional)</span>
            </span>
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="repo root"
              className="font-mono"
            />
          </label>
        )}
      </form.Field>

      <ComposeNameField form={form} projectId={projectId} derivedName={derivedName} />
      <p className="text-[11px] text-muted-foreground">
        Clones the repo, builds each service with a <code>build:</code> context, then deploys the
        whole stack. Track progress on the graph.
      </p>
    </>
  );
}

export function ComposeInlineFields({
  form,
  projectId,
  fileInput,
  editorRef,
  parseContent,
  parsing,
  preview,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
  parsing: boolean;
  preview: Preview | null;
}) {
  // Placeholder name for a blank field: the compose file's own `name:`.
  const derivedName = stackNamePlaceholder("inline", "", preview?.name);
  const buildServices = preview?.services.filter((s) => s.hasBuild) ?? [];
  // Membership set for the expose toggles. Memoized on the array so it is NOT
  // reallocated every render (the old `new Set(useStore(...))` was). The Set
  // only changes when the exposed list actually changes.
  const exposedList = useStore(form.store, (s) => s.values.file.exposed);
  const exposed = useMemo(() => new Set(exposedList), [exposedList]);
  const toggleExpose = (key: string) => {
    const cur = form.state.values.file.exposed;
    form.setFieldValue(
      "file.exposed",
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  };

  return (
    <>
      <ComposeNameField form={form} projectId={projectId} derivedName={derivedName} />
      <form.Field
        name="file.content"
        validators={{
          onChangeAsyncDebounceMs: 400,
          onChangeAsync: ({ value }) => parseContent(value),
        }}
        // Template handoff (or a re-mount after a source toggle): run the same
        // parse the editor's onChange runs, so the preview + `${VAR}` rows
        // populate exactly as if the operator had pasted the file, no effect.
        listeners={{ onMount: ({ value }) => void parseContent(value) }}
      >
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Compose file</span>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="h-7 gap-1.5"
                onClick={() => fileInput.current?.click()}
              >
                <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
                Upload
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".yml,.yaml,text/yaml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void file.text().then((text) => field.handleChange(text));
                }}
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-input bg-input/30 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <CodeMirror
                ref={editorRef}
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                theme="none"
                extensions={editorExtensions}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: false,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: false,
                  autocompletion: false,
                  bracketMatching: true,
                }}
                spellCheck={false}
                className="max-h-[44vh] min-h-64 overflow-auto text-[12.5px]"
              />
            </div>
          </div>
        )}
      </form.Field>

      <ComposeExtraFiles form={form} />

      <ComposePreview
        parsing={parsing}
        preview={preview}
        buildServices={buildServices}
        exposed={exposed}
        onToggleExpose={toggleExpose}
      />
    </>
  );
}
