/**
 * The compose file, folded away.
 *
 * A template ships the file. The operator did not write it and, in the normal
 * case, will not read it: leading with a 44vh CodeMirror put line 45 of
 * someone else's YAML above the one thing they actually confirm, which is the
 * parsed service list. So the file collapses to a single row (line count plus
 * a View button) and the services render above it, in
 * compose-wizard-fields.tsx.
 *
 * Expanding shows the file READ-ONLY. Editing is one more click, because a
 * template that needs one line changed must not be a dead end, but nothing
 * about the default flow should invite a stray keystroke into a working file.
 *
 * Pasting a file (no prefill) is the opposite case: there is nothing to
 * preview until you type, so the panel starts open and editable and the
 * surface is exactly what it was before. "Additional files" lives inside the
 * disclosure either way, since a template already ships every file it needs
 * and the control only offered a way to break it.
 */

import { useState } from "react";

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  PencilEdit02Icon,
  Upload01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

import type { ComposeForm } from "./compose-wizard-shared";

import { ComposeExtraFiles } from "./compose-extra-files";
import { editorExtensions } from "./compose-wizard-editor";

/** Lines in the collapsed row's summary. Empty content is 0, not 1. */
function lineCount(content: string): number {
  return content ? content.split("\n").length : 0;
}

export function ComposeFilePanel({
  form,
  fileInput,
  editorRef,
  parseContent,
  hasPrefill,
}: {
  form: ComposeForm;
  fileInput: React.RefObject<HTMLInputElement | null>;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  parseContent: (value: string) => Promise<string | undefined>;
  /** A template seeded the content: fold the file and lock it. */
  hasPrefill: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!hasPrefill);
  const [editing, setEditing] = useState(!hasPrefill);

  return (
    <form.Field
      name="file.content"
      validators={{
        onChangeAsyncDebounceMs: 400,
        onChangeAsync: ({ value }) => parseContent(value),
      }}
      // Template handoff (or a re-mount after a source toggle): run the same
      // parse the editor's onChange runs, so the preview and `${VAR}` rows
      // populate exactly as if the operator had pasted the file, no effect.
      // The field stays mounted while the panel is folded, so this fires once
      // whether or not the editor is on screen.
      listeners={{ onMount: ({ value }) => void parseContent(value) }}
    >
      {(field) => {
        const lines = lineCount(field.state.value);
        const reveal = () => {
          setOpen(true);
          // CodeMirror holds parse diagnostics only while it is mounted, so a
          // parse that ran with the panel folded left no marker to come back
          // to. Re-run it on the way open so the error lands on its line.
          void parseContent(field.state.value);
        };

        return (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <button
                type="button"
                onClick={() => (open ? setOpen(false) : reveal())}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <HugeiconsIcon
                  icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="text-xs font-medium">{t("compose.fileLabel")}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {hasPrefill
                    ? t("compose.fileLinesTemplate", { count: lines })
                    : t("compose.fileLines", { count: lines })}
                </span>
              </button>

              {open ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="h-7 gap-1.5"
                  onClick={reveal}
                >
                  <HugeiconsIcon icon={ViewIcon} className="size-3.5" />
                  {t("compose.view")}
                </Button>
              )}

              {open && !editing ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="h-7 gap-1.5"
                  onClick={() => setEditing(true)}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} className="size-3.5" />
                  {t("common.edit")}
                </Button>
              ) : null}

              {open && editing ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="h-7 gap-1.5"
                  onClick={() => fileInput.current?.click()}
                >
                  <HugeiconsIcon icon={Upload01Icon} className="size-3.5" />
                  {t("compose.upload")}
                </Button>
              ) : null}

              {/* Always mounted: `fileInput` is the ref Upload clicks through. */}
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

            {open ? (
              <>
                <div
                  className={
                    editing
                      ? "overflow-hidden rounded-lg border border-input bg-input/30 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
                      : "overflow-hidden rounded-lg border border-input bg-muted/20"
                  }
                >
                  <CodeMirror
                    ref={editorRef}
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    editable={editing}
                    theme="none"
                    extensions={editorExtensions}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: false,
                      highlightActiveLine: editing,
                      highlightActiveLineGutter: false,
                      autocompletion: false,
                      bracketMatching: true,
                    }}
                    spellCheck={false}
                    className="max-h-[44vh] min-h-64 overflow-auto text-[12.5px]"
                  />
                </div>
                <ComposeExtraFiles form={form} />
              </>
            ) : null}
          </div>
        );
      }}
    </form.Field>
  );
}
