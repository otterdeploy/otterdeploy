/**
 * Parse hook for the Compose wizard: owns the live preview state, pushes
 * CodeMirror diagnostics for parse errors, and seeds the variables editor
 * from the file's `${VAR}` refs. Split out of compose-wizard.tsx to keep
 * that file under the line caps.
 */

import type { ProjectId } from "@otterdeploy/shared/id";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { useState } from "react";

import { type Diagnostic, setDiagnostics } from "@codemirror/lint";

import { orpc } from "@/shared/server/orpc";

import type { Var } from "./form-fields/variables-field";

import { type ComposeForm, type Preview, SECRETISH } from "./compose-wizard-shared";

export function useComposeParse(
  projectId: ProjectId,
  editorRef: React.RefObject<ReactCodeMirrorRef | null>,
  form: ComposeForm,
) {
  const [preview, setPreview] = useState<Preview | null>(null);

  // Push the parse result onto the editor as a CodeMirror diagnostic — red
  // gutter marker + underline + hover message on the offending line. Called
  // right after the parse, so the editor view + its content are in sync.
  const applyDiagnostics = (res: Preview | null) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const diagnostics: Diagnostic[] = [];
    if (res && !res.valid && res.errorLine) {
      const lineNo = Math.min(Math.max(res.errorLine, 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNo);
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "error",
        message: res.error ?? "Invalid YAML",
      });
    }
    view.dispatch(setDiagnostics(view.state, diagnostics));
  };

  // Debounced async parse, run by TanStack Form's `onChangeAsync` on the
  // `content` field — no hand-rolled debounce/query/effect. Stores the preview,
  // updates the editor diagnostics, and returns a field error when invalid so
  // the form itself knows the compose can't be deployed.
  const parseContent = async (value: string): Promise<string | undefined> => {
    const trimmed = value.trim();
    if (!trimmed) {
      setPreview(null);
      applyDiagnostics(null);
      return undefined;
    }
    const res = await orpc.compose.parse.call({ projectId, content: trimmed }).catch(() => null);
    if (!res) {
      const message = "Couldn't reach the parser";
      const fail: Preview = {
        valid: false,
        error: message,
        errorLine: null,
        errorColumn: null,
        name: null,
        vars: [],
        services: [],
        warnings: [],
      };
      setPreview(fail);
      applyDiagnostics(fail);
      return message;
    }
    setPreview(res);
    applyDiagnostics(res);
    // Seed the variables editor with the file's `${VAR}` refs (defaults
    // prefilled, credential-looking keys locked), preserving any rows the user
    // already added/edited. The user then edits them in the full editor.
    const current = form.state.values.variables;
    const seeded: Var[] = res.vars.map((ref) => {
      const existing = current.find((c) => c.key === ref.name);
      return (
        existing ?? {
          key: ref.name,
          value: ref.default ?? "",
          secret: SECRETISH.test(ref.name),
        }
      );
    });
    // Keep any extra rows the user added that aren't refs in the file.
    const extra = current.filter((c) => !res.vars.some((ref) => ref.name === c.key));
    form.setFieldValue("variables", [...seeded, ...extra]);
    return res.valid ? undefined : `line ${res.errorLine ?? "?"}: ${res.error ?? "Invalid YAML"}`;
  };

  return { preview, parseContent };
}
