/**
 * CodeMirror editor config (theme + YAML highlight) for the Compose
 * wizard's inline file editor. Split out of compose-wizard.tsx to keep that
 * file under the max-lines cap.
 */

import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Make CodeMirror transparent so it inherits the dark wrapper (no white box),
// with a muted line-number gutter — matches the Caddyfile editor's look.
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
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)",
    },
  },
  { dark: true },
);

// @lezer/yaml tags: keys → definition(propertyName); QUOTED scalars → string;
// PLAIN scalars (incl. numbers/bools) → content (YAML has no number/bool tags).
// Color quoted + plain scalars the same so values read consistently.
const highlightStyle = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName], color: "#79c0ff" },
  { tag: [t.string, t.special(t.string), t.content], color: "#7ee787" },
  { tag: [t.typeName, t.labelName], color: "#ffa657" }, // !Tag, &anchors
  {
    // `--muted-foreground` is a hex token, so use it directly — `hsl(var(...))`
    // would be invalid CSS and silently drop the color.
    tag: [t.comment, t.lineComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
]);

export const editorExtensions = [
  editorTheme,
  yaml(),
  syntaxHighlighting(highlightStyle),
  lintGutter(),
];
