/**
 * Supporting files for a multi-file inline compose stack: scripts, Dockerfiles,
 * .env files, configs the compose file references (build contexts, env_file,
 * bind mounts). Paths may be nested (`scripts/init.sh` → a folder). Split out of
 * compose-wizard-fields.tsx to keep that file under the line cap.
 */
import { useStore } from "@tanstack/react-form";
import CodeMirror from "@uiw/react-codemirror";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import type { ComposeForm } from "./compose-wizard-shared";

import { editorExtensions } from "./compose-wizard-editor";

export function ComposeExtraFiles({ form }: { form: ComposeForm }) {
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
              onChange={(v) => setFiles(files.map((x, j) => (j === i ? { ...x, content: v } : x)))}
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
