/**
 * Source-specific field groups for the Compose wizard: the optional stack
 * name, the git-source inputs, and the inline file editor + preview. Split
 * out of compose-wizard.tsx to keep that file under the line caps.
 */

import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-form";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import type { ComposeForm, DetectedService, Preview } from "./compose-wizard-shared";

import { ComposePreview } from "./compose-preview";
import { editorExtensions } from "./compose-wizard-editor";
import { RepoPicker } from "./steps/repo-picker";
import { useBindingSummary } from "./steps/source-binding";
import { BranchPicker } from "./steps/source-pickers";

function ComposeNameField({ form, derivedName }: { form: ComposeForm; derivedName: string }) {
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
        </label>
      )}
    </form.Field>
  );
}

export function ComposeGitFields({
  form,
  derivedName,
  projectSlug,
}: {
  form: ComposeForm;
  derivedName: string;
  projectSlug: ProjectSlug;
}) {
  // Same repo-selection surface git services use: an account/repo picker over
  // the connected GitHub App installations (private-capable). `gitRepoId` bound
  // → clone via the installation token; a pasted public URL is the fallback.
  const { installations, projectId, hasInstallations } = useBindingSummary(projectSlug);
  const gitRepoId = useStore(form.store, (s) => s.values.gitRepoId);
  const repoFullName = useStore(form.store, (s) => s.values.repoFullName);

  return (
    <>
      {hasInstallations ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Repository</span>
          <RepoPicker
            installations={installations}
            projectId={projectId}
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

      <div className="grid grid-cols-2 gap-3">
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
        <form.Field name="composePath">
          {(field) => (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                Compose file <span className="text-muted-foreground/60">(optional)</span>
              </span>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="auto-detect"
                className="font-mono"
              />
            </label>
          )}
        </form.Field>
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

      <ComposeNameField form={form} derivedName={derivedName} />
      <p className="text-[11px] text-muted-foreground">
        Clones the repo, builds each service with a <code>build:</code> context, then deploys the
        whole stack. Track progress on the graph.
      </p>
    </>
  );
}

/** Supporting files for a multi-file inline stack: scripts, Dockerfiles, .env,
 *  configs the compose file references (build contexts, env_file, bind mounts).
 *  Paths may be nested (`scripts/init.sh` → a folder). */
function ComposeExtraFiles({ form }: { form: ComposeForm }) {
  const files = useStore(form.store, (s) => s.values.files);
  const setFiles = (next: ComposeForm["state"]["values"]["files"]) =>
    form.setFieldValue("files", next);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Additional files</span>
        <span className="text-[11px] text-muted-foreground/60">
          scripts, Dockerfiles, .env — referenced by your compose file
        </span>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="h-7 gap-1.5"
          onClick={() => setFiles([...files, { path: "", content: "" }])}
        >
          Add file
        </Button>
      </div>
      {files.map((f, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 rounded-lg border border-input bg-input/20 p-2"
        >
          <div className="flex items-center gap-2">
            <Input
              value={f.path}
              placeholder="scripts/init.sh"
              className="h-7 font-mono text-[12px]"
              onChange={(e) =>
                setFiles(files.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))
              }
            />
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="h-7"
              onClick={() => setFiles(files.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border border-input bg-input/30">
            <CodeMirror
              value={f.content}
              onChange={(v) =>
                setFiles(files.map((x, j) => (j === i ? { ...x, content: v } : x)))
              }
              theme="none"
              extensions={editorExtensions}
              basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
              spellCheck={false}
              className="max-h-[28vh] min-h-24 overflow-auto text-[12px]"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ComposeInlineFields({
  form,
  derivedName,
  fileInput,
  editorRef,
  parseContent,
  parsing,
  preview,
  buildServices,
  exposed,
  onToggleExpose,
}: {
  form: ComposeForm;
  derivedName: string;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
  parsing: boolean;
  preview: Preview | null;
  buildServices: DetectedService[];
  exposed: Set<string>;
  onToggleExpose: (key: string) => void;
}) {
  return (
    <>
      <ComposeNameField form={form} derivedName={derivedName} />
      <form.Field
        name="content"
        validators={{
          onChangeAsyncDebounceMs: 400,
          onChangeAsync: ({ value }) => parseContent(value),
        }}
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
        onToggleExpose={onToggleExpose}
      />
    </>
  );
}
