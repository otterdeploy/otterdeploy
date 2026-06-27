/**
 * Dedicated create flow for Docker Compose stacks. Like every other resource,
 * compose now STAGES into the project manifest rather than deploying on submit:
 * paste/upload a compose file → the server parses it for a live preview
 * (`compose.parse`) → "Add resource" writes a `composes[name]` entry to the
 * manifest. The stack then shows on the graph as a pending ghost group, and the
 * pending-changes bar's Deploy (manifest.apply) provisions it. See
 * docs/designs/compose.md.
 */
import type { ProjectId, ProjectSlug } from "@otterdeploy/shared/id";

import { useRef, useState } from "react";

import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { Alert02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { tags as t } from "@lezer/highlight";
import { useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { orpc } from "@/shared/server/orpc";

import type { Var } from "./form-fields/variables-field";

import { useStageManifestChange } from "../../hooks/use-manifest-stage";
import { ComposeServiceIcon } from "./compose-service-icon";
import { useAppForm } from "./form-context";

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

interface DetectedService {
  name: string;
  image: string | null;
  hasBuild: boolean;
  ports: number[];
}

// Credential-looking keys get the secret lock on by default.
const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING)/i;

/** Coerce a display name into a valid manifest resource key
 *  (`^[a-z][a-z0-9-]{0,62}$`): lowercase, non-alnum → dash, trim dashes, and
 *  prefix a letter if it would otherwise start with a digit. */
function toResourceName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (!slug) return "compose-stack";
  return /^[a-z]/.test(slug) ? slug : `s-${slug}`.slice(0, 63);
}

interface VarRef {
  name: string;
  default: string | null;
}

interface Preview {
  valid: boolean;
  error: string | null;
  errorLine: number | null;
  errorColumn: number | null;
  name: string | null;
  vars: VarRef[];
  services: DetectedService[];
  warnings: string[];
}

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

const editorExtensions = [editorTheme, yaml(), syntaxHighlighting(highlightStyle), lintGutter()];

export function ComposeWizard({
  orgSlug,
  projectId,
  projectSlug,
  onComplete,
  onCancel,
}: {
  orgSlug: string;
  projectId: ProjectId;
  projectSlug: ProjectSlug;
  onComplete?: () => void;
  onCancel?: () => void;
}) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Two-step inline flow: paste the file → fill its `${VAR}` values.
  const [step, setStep] = useState<"file" | "vars">("file");

  const stage = useStageManifestChange(projectId, {
    successToast: "Stack staged — review and click Deploy to apply",
  });

  const form = useAppForm({
    defaultValues: {
      name: "",
      source: "inline" as "inline" | "git",
      content: "",
      gitRepoUrl: "",
      gitRef: "",
      composePath: "",
      exposed: [] as string[],
      variables: [] as Var[],
    },
    onSubmit: async ({ value }) => {
      // Stage a `composes[name]` entry into the manifest — no immediate deploy.
      // The graph then shows the stack as a pending ghost; the pending-changes
      // bar's Deploy provisions it (manifest.apply → reconciler).
      const rawName =
        value.name.trim() || (value.source === "git" ? repoName : preview?.name) || "compose-stack";
      const name = toResourceName(rawName);

      // `${VAR}` values → manifest env. Secret-ness is re-derived at apply time
      // from the key name (mirrors the create handler's default).
      const env: Record<string, string> = {};
      for (const v of value.variables) {
        if (v.key.trim() && v.value.trim()) env[v.key.trim()] = v.value;
      }
      const hasEnv = Object.keys(env).length > 0;

      const entry =
        value.source === "inline"
          ? {
              source: "inline" as const,
              content: value.content,
              ...(hasEnv ? { env } : {}),
              exposed: value.exposed.map((k) => {
                const [service, port] = k.split(":");
                return { service: service ?? "", port: Number(port) };
              }),
            }
          : {
              source: "git" as const,
              gitRepoUrl: value.gitRepoUrl.trim(),
              ...(value.gitRef.trim() ? { gitRef: value.gitRef.trim() } : {}),
              // Blank → the builder auto-detects common compose file names.
              ...(value.composePath.trim() ? { composePath: value.composePath.trim() } : {}),
              ...(hasEnv ? { env } : {}),
            };

      await stage.mutateAsync((current) => ({
        ...current,
        project: current.project || projectSlug,
        composes: { ...current.composes, [name]: entry },
      }));
      onComplete?.();
      void navigate({
        to: "/$orgSlug/$projectSlug/graph",
        params: { orgSlug, projectSlug },
      });
    },
  });

  const source = useStore(form.store, (s) => s.values.source);
  const gitRepoUrl = useStore(form.store, (s) => s.values.gitRepoUrl);
  const exposed = new Set(useStore(form.store, (s) => s.values.exposed));
  // The form already tracks the async `content` validation — no manual flag.
  const parsing = useStore(form.store, (s) => Boolean(s.fieldMeta.content?.isValidating));

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

  const buildServices = preview?.services.filter((s) => s.hasBuild) ?? [];
  // A valid, deployable inline file (no build services).
  const inlineReady = source === "inline" && preview?.valid === true && buildServices.length === 0;
  const hasVars = source === "inline" && (preview?.vars.length ?? 0) > 0;
  // Always route an inline file through the variables step before creating, so
  // the operator can review / set / add env values BEFORE the stack deploys —
  // not just when the file happens to declare `${VAR}` refs. (Git source has no
  // inline step; its file + vars are resolved at build time.)
  const showNext = step === "file" && inlineReady;
  const canCreate =
    !stage.isPending && (source === "git" ? gitRepoUrl.trim().length > 0 : inlineReady);

  // What the name will be if left blank — shown as the field's placeholder.
  const repoName = gitRepoUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .split("/")
    .pop();
  const derivedName = (source === "git" ? repoName : preview?.name) || "compose-stack";

  const toggleExpose = (key: string) => {
    const cur = form.state.values.exposed;
    form.setFieldValue("exposed", cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };

  const NameField = (
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

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        // Never create straight from the file step — a submit here (Enter key,
        // the Next button, anything) advances to the variables step instead, so
        // env is always reviewed before the stack is created + deployed.
        if (showNext) {
          setStep("vars");
          return;
        }
        void form.handleSubmit();
      }}
      noValidate
    >
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
        {step === "vars" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Environment variables</span>
              <span className="text-xs text-muted-foreground">
                {hasVars
                  ? "The compose file references these — defaults are pre-filled. "
                  : "Set any variables this stack needs before it deploys. "}
                Edit, add more, or toggle the lock to mark a value secret. Saved as project
                variables.
              </span>
            </div>
            <form.AppField name="variables">
              {(field) => <field.VariablesField projectId={projectId} />}
            </form.AppField>
          </div>
        ) : (
          <>
            <div className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/40 p-0.5">
              {(["inline", "git"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStep("file");
                    form.setFieldValue("source", s);
                  }}
                  className={
                    source === s
                      ? "rounded bg-background px-2.5 py-1 text-xs text-foreground shadow-sm"
                      : "rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  }
                >
                  {s === "inline" ? "Paste file" : "From repo"}
                </button>
              ))}
            </div>

            {source === "git" ? (
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
                {NameField}
                <p className="text-[11px] text-muted-foreground">
                  Clones the repo, builds each service with a <code>build:</code> context, then
                  deploys the whole stack. Track progress on the graph.
                </p>
              </>
            ) : (
              <>
                {NameField}
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
                  onToggleExpose={toggleExpose}
                />
              </>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        {step === "vars" ? (
          <>
            <Button variant="outline" size="sm" type="button" onClick={() => setStep("file")}>
              Back
            </Button>
            <Button size="sm" type="submit" disabled={!canCreate}>
              {stage.isPending ? "Adding…" : "Add resource"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" type="button" onClick={onCancel}>
              Cancel
            </Button>
            {showNext ? (
              <Button size="sm" type="button" onClick={() => setStep("vars")}>
                Next: variables
              </Button>
            ) : (
              <Button size="sm" type="submit" disabled={!canCreate}>
                {stage.isPending ? "Adding…" : "Add resource"}
              </Button>
            )}
          </>
        )}
      </div>
    </form>
  );
}

function ComposePreview({
  parsing,
  preview,
  buildServices,
  exposed,
  onToggleExpose,
}: {
  parsing: boolean;
  preview: Preview | null;
  buildServices: DetectedService[];
  exposed: Set<string>;
  onToggleExpose: (key: string) => void;
}) {
  if (parsing && !preview) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" /> Parsing…
      </div>
    );
  }
  if (!preview) return null;
  if (!preview.valid) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          {preview.errorLine ? (
            <span className="mr-1.5 rounded bg-destructive/15 px-1 py-0.5 font-mono text-[11px]">
              line {preview.errorLine}
              {preview.errorColumn ? `:${preview.errorColumn}` : ""}
            </span>
          ) : null}
          {preview.error ?? "Invalid compose file"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        {preview.services.length} service
        {preview.services.length === 1 ? "" : "s"} detected
      </span>
      <div className="flex flex-col gap-1.5">
        {preview.services.map((s) => (
          <div key={s.name} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <ComposeServiceIcon image={s.image} className="size-4 shrink-0" />
            <span className="font-mono text-[13px]">{s.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {s.image ?? "(builds from source)"}
            </span>
            <div className="flex-1" />
            {s.ports.map((p) => {
              const key = `${s.name}:${p}`;
              const on = exposed.has(key);
              return (
                <button
                  key={p}
                  type="button"
                  title={on ? "Exposed — click to make internal" : "Expose with a public domain"}
                  onClick={() => onToggleExpose(key)}
                  className={
                    on
                      ? "rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] text-primary-foreground"
                      : "rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/70"
                  }
                >
                  {on ? "🌐 " : ""}:{p}
                </button>
              );
            })}
            {s.hasBuild ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600"
              >
                build
              </Badge>
            ) : null}
          </div>
        ))}
      </div>
      {buildServices.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600">
          <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {buildServices.map((s) => s.name).join(", ")} build from source, which isn't supported
            yet — use a prebuilt <code>image:</code> for now.
          </span>
        </div>
      ) : null}
      {preview.warnings.map((w, i) => (
        <p key={i} className="text-[11px] text-muted-foreground">
          · {w}
        </p>
      ))}
    </div>
  );
}
