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
import { collectFileVarRefs } from "@otterdeploy/api/routers/compose/env";
import { randomBase64, randomSecret } from "@otterdeploy/shared/crypto";
import { autofillValue, isSecretKey } from "@otterdeploy/shared/env-var-kind";

import { orpc } from "@/shared/server/orpc";

import type { Var } from "./form-fields/variables-field";

import { type ComposeForm, type ComposePrefill, type Preview } from "./compose-wizard-shared";

/** Refs from several files, unique by name (first wins). */
function dedupeByName<T extends { name: string }>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
}

/**
 * The FQDN a stack's address variables should point at, or null when there is
 * nothing to point them at yet.
 *
 * A compose stack has many services but one *front door*. The thing a
 * `SERVER_URL` means. We take the first service that publishes a port, which
 * is what the exposure step defaults to and what a template's app service
 * always is (its database and worker declare none). Guessing wrong costs an
 * edit on a pre-filled field; guessing nothing costs the operator a hostname
 * they cannot know before deploying.
 *
 * The name→FQDN step goes through `project.resource.publicHostPreview`, the
 * same resolver chain `exposeService` walks (project custom domain → org base
 * → local dev base → sslip fallback), so this is a preview of the real value
 * rather than a client-side reconstruction that could drift from it.
 */
async function previewStackHost(
  projectId: ProjectId,
  preview: { services: { name: string; ports: number[] }[] },
): Promise<string | null> {
  const front = preview.services.find((s) => s.ports.length > 0);
  if (!front) return null;
  const resolved = await orpc.project.resource.publicHostPreview
    .call({ projectId, name: front.name })
    .catch(() => null);
  return resolved?.fqdn ?? null;
}

/**
 * Pre-select public exposure for services that publish a port.
 *
 * Declaring `ports:` in a compose file IS the statement "this one is meant to
 * be reached"; leaving the exposure list empty made every stack deploy private
 * and silent about it. Authentik declares `ports: 9000` on its server, deployed
 * clean, and then had no public route and an Exposed Services panel reading
 * "No public routes": with nothing saying the operator had to go and ask.
 *
 * Seeded, not forced: this only ever runs when the operator has not touched the
 * list, so unticking a service sticks and a re-parse (every keystroke in the
 * editor) cannot re-tick it. Services with no published port (databases,
 * caches, workers) are never selected, because they never asked to be.
 */
function seedExposure(form: ComposeForm, preview: Preview): void {
  if (form.state.values.file.exposed.length > 0) return;
  const seeds = preview.services.flatMap((svc) =>
    svc.ports.length > 0 ? [`${svc.name}:${svc.ports[0]}`] : [],
  );
  if (seeds.length > 0) form.setFieldValue("file.exposed", seeds);
}

export function useComposeParse(
  projectId: ProjectId,
  editorRef: React.RefObject<ReactCodeMirrorRef | null>,
  form: ComposeForm,
  /** Wire formats declared by the template this stack came from, keyed by
   *  variable name. Empty for a hand-pasted compose file. */
  generate?: ComposePrefill["generate"],
) {
  const [preview, setPreview] = useState<Preview | null>(null);

  // Push the parse result onto the editor as a CodeMirror diagnostic. Red
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
  // `content` field, no hand-rolled debounce/query/effect. Stores the preview,
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
    seedExposure(form, res);
    // The public FQDN this stack will publish at, resolved by the SAME server
    // chain the expose path walks, so an address we seed is the address the
    // service actually gets, not a guess. Best-effort: a failure just leaves
    // address vars blank, exactly as before.
    const publicHost = await previewStackHost(projectId, res);
    // Seed the variables editor with the file's `${VAR}` refs, preserving any
    // rows the user already added/edited. A credential-looking key with no
    // `:-default` is AUTO-GENERATED (strong random, locked) and an address-
    // looking key is filled with the resolved public URL. The operator never
    // has to hand-type a password or paste back a hostname they can't know
    // yet. Both stay editable, so they can override or regenerate.
    const current = form.state.values.vars.variables;
    // A stack's variables are not only the compose file's. A supporting file
    // flagged `interpolate` resolves from the SAME bag at materialize time, so
    // a key living only in a shipped config.yaml has to be prompted for here
    // too. It wasn't, and NetBird's `authSecret` — which exists nowhere in its
    // compose — was therefore never asked for, rendered empty, and crash-looped
    // the server on its own schema. Compose refs win a tie: `res.vars` carries
    // the parser's own `:-default` handling.
    const fileRefs = form.state.values.file.files
      .filter((f) => f.interpolate)
      .flatMap((f) => collectFileVarRefs(f.content))
      .filter((ref) => !res.vars.some((v) => v.name === ref.name));
    const refs = [...res.vars, ...dedupeByName(fileRefs)];
    const seeded: Var[] = refs.map((ref) => {
      // No `:-default` in the compose → the operator MUST supply a value (we
      // auto-fill secrets; non-secrets still need input). Drives the required *.
      const required = ref.default === null;
      const existing = current.find((c) => c.key === ref.name);
      // Preserve the operator's edits (value/secret) but ALWAYS refresh
      // `required` from the current parse. Otherwise a row seeded before this
      // flag existed keeps `required: undefined` and never shows its marker.
      if (existing) return existing.required === required ? existing : { ...existing, required };
      // A declared format wins over the generic fill: `randomSecret` is
      // url-safe and unpadded, so an upstream that actually DECODES the value
      // rejects it. NetBird's store key did, on every boot.
      const spec = generate?.[ref.name];
      const generated = spec ? randomBase64(spec.bytes) : null;
      return {
        key: ref.name,
        value:
          ref.default ?? generated ?? autofillValue(ref.name, { randomSecret, publicHost }) ?? "",
        secret: isSecretKey(ref.name),
        required,
      };
    });
    // Keep any extra rows the user added that aren't refs in the file.
    const extra = current.filter((c) => !refs.some((ref) => ref.name === c.key));
    form.setFieldValue("vars.variables", [...seeded, ...extra]);
    if (!res.valid) return `line ${res.errorLine ?? "?"}: ${res.error ?? "Invalid YAML"}`;
    // A `build:` service can't deploy inline yet (those go through git), so make
    // that a FIELD error: the "file" step then reads not-deployable straight off
    // the content field's validity, no separate `isInlineReady`/`buildServices`
    // flag. The amber band in ComposePreview names the offending services.
    const buildServices = res.services.filter((s) => s.hasBuild);
    if (buildServices.length > 0) {
      return `${buildServices.map((s) => s.name).join(", ")} build from source. Deploy from a repo`;
    }
    return undefined;
  };

  return { preview, parseContent };
}
