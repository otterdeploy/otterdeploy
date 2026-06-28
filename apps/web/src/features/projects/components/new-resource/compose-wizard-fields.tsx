/**
 * Source-specific field groups for the Compose wizard: the optional stack
 * name, the git-source inputs, and the inline file editor + preview. Split
 * out of compose-wizard.tsx to keep that file under the line caps.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import type { ComposeForm, DetectedService, Preview } from "./compose-wizard-shared";

import { ComposePreview } from "./compose-preview";
import { editorExtensions } from "./compose-wizard-editor";

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
}: {
  form: ComposeForm;
  derivedName: string;
}) {
  return (
    <>
      <form.Field name="gitRepoUrl">
        {(field) => (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Repository URL</span>
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="font-mono"
              autoFocus
            />
          </label>
        )}
      </form.Field>
      <div className="grid grid-cols-2 gap-3">
        <form.Field name="gitRef">
          {(field) => (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Branch</span>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="main"
                className="font-mono"
              />
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
      <ComposeNameField form={form} derivedName={derivedName} />
      <p className="text-[11px] text-muted-foreground">
        Clones the repo, builds each service with a <code>build:</code> context, then deploys the
        whole stack. Track progress on the graph.
      </p>
    </>
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
