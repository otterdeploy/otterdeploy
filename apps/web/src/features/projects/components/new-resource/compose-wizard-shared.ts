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
}

// Credential-looking keys get the secret lock on by default.
export const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|DSN|AUTH|SALT|WEBHOOK|SIGNING)/i;

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

export function useComposeForm(onSubmit: (value: ComposeFormValues) => Promise<void>) {
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
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}

export type ComposeForm = ReturnType<typeof useComposeForm>;

/** Derived flags the wizard chrome reads — pulled out of the component body
 *  so its cyclomatic complexity stays under the cap. */
export function deriveComposeFlags(args: {
  source: "inline" | "git";
  gitRepoUrl: string;
  preview: Preview | null;
  step: "file" | "vars";
  stagePending: boolean;
}) {
  const { source, gitRepoUrl, preview, step, stagePending } = args;
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
    !stagePending && (source === "git" ? gitRepoUrl.trim().length > 0 : inlineReady);

  // What the name will be if left blank — shown as the field's placeholder.
  const repoName = gitRepoUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .split("/")
    .pop();
  const derivedName = (source === "git" ? repoName : preview?.name) || "compose-stack";

  return { buildServices, inlineReady, hasVars, showNext, canCreate, repoName, derivedName };
}
