/**
 * The CodeMirror half of the Compose file tab: the shared YAML theme, the
 * read-only viewer a git-sourced stack gets, and the editable one an inline
 * stack gets.
 *
 * Split out of ./panel-tabs so the tab components stay about tab layout — this
 * module owns everything CodeMirror, and is the only place the editor theme and
 * highlight style are defined.
 */

import { useState } from "react";

import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useMutation } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { toast } from "sonner";

import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

// Read-only YAML viewer — transparent so it inherits the panel surface.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "color-mix(in srgb, currentColor 35%, transparent)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 10px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": { backgroundColor: "transparent" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName], color: "#79c0ff" },
  { tag: [t.string, t.special(t.string), t.content], color: "#7ee787" },
  { tag: [t.typeName, t.labelName], color: "#ffa657" },
  {
    tag: [t.comment, t.lineComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
]);

const viewerExtensions = [editorTheme, yaml(), syntaxHighlighting(highlightStyle)];

const basicSetup = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
} as const;

/** Read-only YAML viewer — transparent so it inherits the panel surface. */
export function ComposeViewer({ content }: { content: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background/40">
      <CodeMirror
        value={content}
        readOnly
        editable={false}
        theme="none"
        extensions={viewerExtensions}
        basicSetup={basicSetup}
      />
    </div>
  );
}

/** Editable compose YAML for an inline stack. Saves via compose.updateContent,
 *  which re-parses + keeps the project manifest in lockstep; the change takes
 *  effect on the next redeploy. */
export function ComposeFileEditor({
  projectId,
  resourceId,
  initialContent,
}: {
  projectId: string;
  resourceId: string;
  initialContent: string;
}) {
  const [draft, setDraft] = useState(initialContent);
  // Baseline the Save button dirties against — updated on a successful save so
  // the button settles without waiting for the invalidated query to refetch.
  const [baseline, setBaseline] = useState(initialContent);
  const dirty = draft !== baseline && draft.trim().length > 0;

  const save = useMutation({
    ...orpc.compose.updateContent.mutationOptions(),
    onSuccess: async (_data, variables) => {
      setBaseline(variables.composeContent);
      toast.success("Compose file saved", {
        description: "Redeploy the stack to apply your changes.",
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.compose.get.queryKey({
            input: { projectId, resourceId },
          }),
        }),
        // The graph card reads the parsed service summary off the resource list.
        queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      ]);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save compose file"),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border bg-background/40">
        <CodeMirror
          value={draft}
          theme="none"
          extensions={viewerExtensions}
          onChange={setDraft}
          basicSetup={basicSetup}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="mr-auto text-[11px] text-muted-foreground">
          Edits take effect on the next redeploy.
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() => setDraft(baseline)}
        >
          Reset
        </Button>
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              projectId,
              resourceId,
              composeContent: draft,
            })
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
