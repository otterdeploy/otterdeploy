/**
 * Shared types, constants, form shape and helpers for the Compose wizard.
 * Split out of compose-wizard.tsx to keep that file + its main component
 * under the line caps.
 */

import type { Var } from "./form-fields/variables-field";

import { useAppForm } from "./form-context";

export interface DetectedService {
  name: string;
  image: string | null;
  hasBuild: boolean;
  ports: number[];
}

export interface VarRef {
  name: string;
  default: string | null;
}

export interface Preview {
  valid: boolean;
  error: string | null;
  errorLine: number | null;
  errorColumn: number | null;
  name: string | null;
  vars: VarRef[];
  services: DetectedService[];
  warnings: string[];
}

export interface ComposeFormValues {
  name: string;
  source: "inline" | "git";
  content: string;
  /** Inline supporting files (scripts, Dockerfiles, .env, configs) alongside the
   *  compose file in `content`. Paths may be nested (`scripts/init.sh`). */
  files: Array<{ path: string; content: string }>;
  /** Bound repo id from the picker (private-capable). Preferred over gitRepoUrl. */
  gitRepoId: string;
  /** `owner/repo` for the bound repo — display only. */
  repoFullName: string;
  /** Legacy public-URL paste (used when no installation / no picked repo). */
  gitRepoUrl: string;
  gitRef: string;
  composePath: string;
  /** Root directory within the repo the stack builds from. */
  sourceSubdir: string;
  exposed: string[];
  variables: Var[];
}

/** Seed for the wizard when a stack arrives from the templates gallery:
 *  display name + the template's compose YAML. The wizard parses the content
 *  through the normal preview path, so the operator still reviews services
 *  and `${VAR}` values before anything is staged. */
export interface ComposePrefill {
  name: string;
  content: string;
  /** SvglLogo search string from the template — persisted on the stack so the
   *  graph node shows the template's brand mark. */
  logoBrand?: string;
}

/** Coerce a display name into a valid manifest resource key
 *  (`^[a-z][a-z0-9-]{0,62}$`): lowercase, non-alnum → dash, trim dashes, and
 *  prefix a letter if it would otherwise start with a digit. */
export function toResourceName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (!slug) return "compose-stack";
  return /^[a-z]/.test(slug) ? slug : `s-${slug}`.slice(0, 63);
}

export function useComposeForm() {
  return useAppForm({
    defaultValues: {
      name: "",
      source: "inline",
      content: "",
      files: [],
      gitRepoId: "",
      repoFullName: "",
      gitRepoUrl: "",
      gitRef: "",
      composePath: "",
      sourceSubdir: "",
      exposed: [],
      variables: [],
    } as ComposeFormValues,
  });
}

export type ComposeForm = ReturnType<typeof useComposeForm>;

/** Is the pasted file something we can deploy as-is? Inline only, parsed
 *  clean, and with no service that needs a build (those go through git).
 *  Split out of deriveComposeFlags — it's the one question the whole "Next /
 *  Create" chrome hangs off, and it deserves a name. */
function isInlineReady(
  source: "inline" | "git",
  preview: Preview | null,
  buildServices: DetectedService[],
): boolean {
  if (source !== "inline") return false;
  return preview?.valid === true && buildServices.length === 0;
}

/** Does the file declare a `${VAR}` ref WITHOUT a `:-default` that the operator
 *  hasn't filled in yet? Split out of deriveComposeFlags because it owns the
 *  required-vs-defaulted distinction on its own.
 *
 *  The stack can't deploy correctly until these are set (e.g. Authentik's
 *  POSTGRES_PASSWORD), so staging stays blocked while any is blank — otherwise
 *  the vars step can be clicked straight through and the stack lands in the
 *  pending state with an empty password, which is exactly the "janky" bypass. */
function hasUnsetRequiredVars(
  source: "inline" | "git",
  preview: Preview | null,
  variables: Var[],
): boolean {
  if (source !== "inline") return false;
  const requiredKeys = new Set(
    (preview?.vars ?? []).filter((v) => v.default === null).map((v) => v.name),
  );
  return variables.some((v) => requiredKeys.has(v.key.trim()) && v.value.trim() === "");
}

/** The stack's name when the operator leaves the field blank: the repo's last
 *  path segment for git, the compose file's own `name:` for inline. Split out
 *  of deriveComposeFlags so the URL-tidying lives next to the fallback it
 *  feeds. */
function deriveStackName(
  source: "inline" | "git",
  gitRepoUrl: string,
  preview: Preview | null,
): { repoName: string | undefined; derivedName: string } {
  const repoName = gitRepoUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .split("/")
    .pop();
  const candidate = source === "git" ? repoName : preview?.name;
  return { repoName, derivedName: candidate || "compose-stack" };
}

/** Derived flags the wizard chrome reads — pulled out of the component body
 *  so its cyclomatic complexity stays under the cap. */
export function deriveComposeFlags(args: {
  source: "inline" | "git";
  gitRepoUrl: string;
  preview: Preview | null;
  step: "file" | "vars";
  stagePending: boolean;
  variables: Var[];
}) {
  const { source, gitRepoUrl, preview, step, stagePending, variables } = args;
  const buildServices = preview?.services.filter((s) => s.hasBuild) ?? [];
  // A valid, deployable inline file (no build services).
  const inlineReady = isInlineReady(source, preview, buildServices);
  const hasVars = source === "inline" && (preview?.vars.length ?? 0) > 0;
  const requiredUnset = hasUnsetRequiredVars(source, preview, variables);
  // Always route an inline file through the variables step before creating, so
  // the operator can review / set / add env values BEFORE the stack deploys —
  // not just when the file happens to declare `${VAR}` refs. (Git source has no
  // inline step; its file + vars are resolved at build time.)
  const showNext = step === "file" && inlineReady;
  const gitReady = gitRepoUrl.trim().length > 0;
  const sourceReady = source === "git" ? gitReady : inlineReady;
  const canCreate = !stagePending && !requiredUnset && sourceReady;

  // What the name will be if left blank — shown as the field's placeholder.
  const { repoName, derivedName } = deriveStackName(source, gitRepoUrl, preview);

  return {
    buildServices,
    inlineReady,
    hasVars,
    showNext,
    canCreate,
    repoName,
    derivedName,
    requiredUnset,
  };
}
