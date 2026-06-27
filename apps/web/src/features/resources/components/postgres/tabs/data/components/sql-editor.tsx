/**
 * CodeMirror SQL editor for the data console. Line numbers, Postgres syntax
 * highlighting, schema-aware autocomplete, and a per-statement **run gutter**:
 * every statement shows a ▶ that runs just that statement. ⌘↵ runs the
 * statement under the cursor. Nothing auto-runs — execution is always an
 * explicit click or keypress.
 *
 * The imperative ref exposes run-all / run-selection / run-current for the
 * toolbar's Run dropdown.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";

import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { cn } from "@/shared/lib/utils";

import { splitStatements, type SqlStatement } from "../data/sql-statements";

export interface SqlEditorHandle {
  /** Run the whole buffer as one request (psql executes statements in order). */
  runAll: () => void;
  /** Run only the selected text, if any; otherwise the current statement. */
  runSelection: () => void;
  /** Run the statement under the cursor. */
  runCurrent: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** table → columns, for autocomplete. */
  schema?: Record<string, string[]>;
  /** Execute a piece of SQL (gutter ▶, ⌘↵, toolbar). */
  onRun: (sql: string) => void;
  className?: string;
}

// Statements recomputed on every doc change; the gutter + keymap read this.
const statementsField = StateField.define<SqlStatement[]>({
  create: (state) => splitStatements(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? splitStatements(tr.newDoc.toString()) : value),
});

function statementOnLine(view: EditorView, lineFrom: number): SqlStatement | null {
  const stmts = view.state.field(statementsField);
  for (const s of stmts) {
    if (view.state.doc.lineAt(s.from).from === lineFrom) return s;
  }
  return null;
}

function statementAtCursor(view: EditorView): SqlStatement | null {
  const stmts = view.state.field(statementsField);
  if (stmts.length === 0) return null;
  const pos = view.state.selection.main.head;
  return (
    stmts.find((s) => pos >= s.from && pos <= s.to) ??
    stmts.find((s) => s.from >= pos) ??
    stmts[stmts.length - 1] ??
    null
  );
}

class RunMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-run-marker";
    el.textContent = "▶";
    el.title = "Run this statement";
    return el;
  }
}
const runMarker = new RunMarker();

const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontSize: "12.5px",
      lineHeight: "1.7",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--muted-foreground)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 12px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)",
    },
    ".cm-run-gutter": { width: "16px" },
    ".cm-run-marker": {
      color: "#22c55e",
      cursor: "pointer",
      fontSize: "10px",
      opacity: "0.85",
    },
    ".cm-run-marker:hover": { opacity: "1" },
    ".cm-tooltip-autocomplete": { fontSize: "12px" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#ff7b72" },
  { tag: [t.number, t.bool, t.null], color: "#79c0ff" },
  { tag: [t.string, t.special(t.string)], color: "#7ee787" },
  { tag: [t.typeName, t.className], color: "#ffa657" },
  { tag: t.function(t.variableName), color: "#d2a8ff" },
  {
    tag: [t.lineComment, t.blockComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
]);

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, schema, onRun, className },
  ref,
) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  // Keep the latest onRun without reconfiguring the editor on every render.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const extensions = useMemo(() => {
    const runGutter = gutter({
      class: "cm-run-gutter",
      lineMarker: (view, line) => (statementOnLine(view, line.from) ? runMarker : null),
      lineMarkerChange: (update) => update.docChanged,
      domEventHandlers: {
        mousedown: (view, line) => {
          const stmt = statementOnLine(view, line.from);
          if (stmt) {
            onRunRef.current(stmt.text);
            return true;
          }
          return false;
        },
      },
    });

    const runKeymap = keymap.of([
      {
        key: "Mod-Enter",
        preventDefault: true,
        run: (view) => {
          const stmt = statementAtCursor(view);
          if (stmt) onRunRef.current(stmt.text);
          return true;
        },
      },
    ]);

    return [
      sql({ dialect: PostgreSQL, schema, upperCaseKeywords: false }),
      syntaxHighlighting(highlightStyle),
      statementsField,
      runGutter,
      runKeymap,
      editorTheme,
      EditorView.lineWrapping,
    ];
  }, [schema]);

  useImperativeHandle(
    ref,
    () => ({
      runAll: () => {
        const v = cmRef.current?.view;
        if (!v) return;
        const all = v.state.doc.toString().trim();
        if (all) onRunRef.current(all);
      },
      runSelection: () => {
        const v = cmRef.current?.view;
        if (!v) return;
        const sel = v.state.selection.main;
        const text = v.state.sliceDoc(sel.from, sel.to).trim();
        if (text) {
          onRunRef.current(text);
          return;
        }
        const stmt = statementAtCursor(v);
        if (stmt) onRunRef.current(stmt.text);
      },
      runCurrent: () => {
        const v = cmRef.current?.view;
        if (!v) return;
        const stmt = statementAtCursor(v);
        if (stmt) onRunRef.current(stmt.text);
      },
    }),
    [],
  );

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
        highlightActiveLineGutter: false,
      }}
      spellCheck={false}
      className={cn("h-full min-h-0 text-[12.5px]", className)}
      height="100%"
    />
  );
});
