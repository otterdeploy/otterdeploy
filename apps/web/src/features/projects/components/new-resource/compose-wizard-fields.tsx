/**
 * Source-specific field groups for the Compose wizard: the optional stack
 * name, the git-source inputs, and the inline file editor + preview. Split
 * out of compose-wizard.tsx to keep that file under the line caps.
 *
 * The stack name's collision indicator (`useUniqueStackName`) is resolved right
 * here in `ComposeNameField` rather than threaded from the owner — the hook is
 * query-backed, so this call and the owner's write-time call share one cache
 * entry and stay in lockstep. Likewise each group derives its own placeholder
 * name from what it already has (git: the repo URL; inline: the parsed `name:`).
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
import { ComposePreview } from "./compose-preview";
import { stackNamePlaceholder } from "./compose-schema";
import { editorExtensions } from "./compose-wizard-editor";
import { RepoPicker } from "./steps/repo-picker";
import { useBindingSummary } from "./steps/source-binding";
import { BranchPicker } from "./steps/source-pickers";
import { useUniqueStackName } from "./use-unique-stack-name";

function ComposeNameField({
  form,
  projectId,
  derivedName,
}: {
  form: ComposeForm;
  projectId: ProjectId;
  derivedName: string;
}) {
  const name = useStore(form.store, (s) => s.values.name);
  // Resolve the collision-free name for display. stageStack calls the same hook
  // for the write; both share the manifest query cache, so the "already exists"
  // note and the name actually staged never disagree.
  const unique = useUniqueStackName(projectId, name, derivedName);
  return (
    <form.Field name="name">
      {(field) => (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Stack name <span className="text-muted-foreground/60">(optional)</span>
          </span>
          <Input
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder={derivedName}
            className="font-mono"
          />
          {/* Already-in-project notice: not an error — we just stage a new copy
              under the bumped name so a re-deployed template doesn't silently
              overwrite the existing stack. */}
          {unique.collides ? (
            <span className="text-[11px] text-muted-foreground">
              A stack named <span className="font-mono">{unique.base}</span> already exists — this
              one deploys as <span className="font-mono text-foreground">{unique.name}</span>.
            </span>
          ) : null}
        </label>
      )}
    </form.Field>
  );
}

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
  const gitRepoId = useStore(form.store, (s) => s.values.gitRepoId);
  const gitRepoUrl = useStore(form.store, (s) => s.values.gitRepoUrl);
  const repoFullName = useStore(form.store, (s) => s.values.repoFullName);
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
              form.setFieldValue("gitRepoId", repoId);
              form.setFieldValue("repoFullName", fullName);
              // Bound repo wins over any pasted URL.
              form.setFieldValue("gitRepoUrl", "");
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
        <form.Field name="gitRepoUrl">
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
        <form.Field name="gitRef">
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

      <form.Field name="sourceSubdir">
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
  // reallocated every render (the old `new Set(useStore(...))` was) — the Set
  // only changes when the exposed list actually changes.
  const exposedList = useStore(form.store, (s) => s.values.exposed);
  const exposed = useMemo(() => new Set(exposedList), [exposedList]);
  const toggleExpose = (key: string) => {
    const cur = form.state.values.exposed;
    form.setFieldValue("exposed", cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };

  return (
    <>
      <ComposeNameField form={form} projectId={projectId} derivedName={derivedName} />
      <form.Field
        name="content"
        validators={{
          onChangeAsyncDebounceMs: 400,
          onChangeAsync: ({ value }) => parseContent(value),
        }}
        // Template handoff (or a re-mount after a source toggle): run the same
        // parse the editor's onChange runs, so the preview + `${VAR}` rows
        // populate exactly as if the operator had pasted the file — no effect.
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
