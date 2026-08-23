/**
 * Schema-owned validation for the Compose create wizard, expressed with the
 * `<form.FormGroup>` API. The compose flow's answer to the resource wizard's
 * `schemas/` union (see ./schemas/index.ts and ./wizard-form.ts for the pattern
 * this mirrors), but built the way TanStack Form's docs recommend for a
 * multi-step wizard: one zod schema PER step, each validating that step's own
 * slice of a NESTED form value.
 *
 * The form value is split into two groups, `file` and `vars`, so each step's
 * schema can validate exactly its slice with no cast: a `FormGroup`'s `name` is
 * a DeepKeys path and the group validates the `DeepValue` at that path, so
 * `fileStepSchema`'s input type IS `ComposeFileValues` and `varsStepSchema`'s
 * input type IS `ComposeVarsValues`. They drop onto each group's own
 * `validators.onDynamic` with no `as`-cast (the lint's `assertionStyle: never`
 * would reject one). `composeFormSchema` composes both for the parent form's
 * `onDynamic`, the "bypass net" that flags a partially-validated form if a group
 * is skipped (see the multi-step-wizard guide).
 *
 * Two steps:
 *   - "file": pick a source. Inline needs pasted content; git needs a repo.
 *     Whether inline content is *deployable* (parsed clean, no `build:`
 *     service) is decided by the async `content` field validator in
 *     compose-wizard-parse.ts. A field error, not a schema rule, because that
 *     verdict comes from the server parse and can't be seen in the form values.
 *   - "vars": every REQUIRED `${VAR}` (declared with no `:-default`) must have
 *     a value before the stack can stage.
 */

import * as z from "zod";

import type { Var } from "./form-fields/variables-field";

/** The wizard's two steps. Inline flows file → vars; git has only the file
 *  step (its file + vars are resolved at build time, not in this dialog). One
 *  React `useState` picks which group renders; the schema no longer carries a
 *  `__step` discriminator. */
export type ComposeStep = "file" | "vars";

/** The `file` group: everything the source step collects. The FormGroup named
 *  "file" validates exactly this slice, so `fileStepSchema` below is cast-free. */
export interface ComposeFileValues {
  name: string;
  source: "inline" | "git";
  content: string;
  /** Inline supporting files (scripts, Dockerfiles, .env, configs) alongside the
   *  compose file in `content`. Paths may be nested (`scripts/init.sh`).
   *  `interpolate` opts a file into `${VAR}` resolution at deploy (templates
   *  set it; a pasted script must keep its own `${…}` intact). */
  files: Array<{ path: string; content: string; interpolate?: boolean }>;
  /** Bound repo id from the picker (private-capable). Preferred over gitRepoUrl. */
  gitRepoId: string;
  /** `owner/repo` for the bound repo, display only. */
  repoFullName: string;
  /** Legacy public-URL paste (used when no installation / no picked repo). */
  gitRepoUrl: string;
  gitRef: string;
  composePath: string;
  /** Root directory within the repo the stack builds from. */
  sourceSubdir: string;
  exposed: string[];
}

/** The `vars` group: the `${VAR}` rows the second step edits. */
export interface ComposeVarsValues {
  variables: Var[];
}

/** The full nested form value. Every field reference in the wizard is a nested
 *  path (`file.content`, `vars.variables`, etc.) so each group's schema can
 *  own its own slice. */
export interface ComposeFormValues {
  file: ComposeFileValues;
  vars: ComposeVarsValues;
}

export const composeDefaults: ComposeFormValues = {
  file: {
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
  },
  vars: {
    variables: [],
  },
};

// A single `${VAR}` row. `required` is the "declared with no `:-default`" flag
// the parse seeds onto each row (compose-wizard-parse.ts). The vars step hangs
// its whole "is this complete?" question off it.
const varRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
  required: z.boolean().optional(),
});

/**
 * The "file" step's schema, validating the `file` group's slice. Every field is
 * declared (unconstrained) so the schema's INPUT type equals `ComposeFileValues`
 * exactly: that match is what lets it wire onto the FormGroup's own
 * `validators.onDynamic` with no cast. The step gating lives in the superRefine;
 * error `path`s are RELATIVE to the group (`["gitRepoUrl"]` → `file.gitRepoUrl`),
 * which is how standard schemas address a form group's sub-fields.
 */
export const fileStepSchema = z
  .object({
    name: z.string(),
    source: z.enum(["inline", "git"]),
    content: z.string(),
    files: z.array(
      z.object({ path: z.string(), content: z.string(), interpolate: z.boolean().optional() }),
    ),
    gitRepoId: z.string(),
    repoFullName: z.string(),
    gitRepoUrl: z.string(),
    gitRef: z.string(),
    composePath: z.string(),
    sourceSubdir: z.string(),
    exposed: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    // Only assert "there is *a* source to work with"; the deployability of
    // inline content (parsed clean, no `build:` service) is the async `content`
    // field validator's verdict, not a schema rule. That comes from the server
    // parse and can't be seen in the form values.
    if (v.source === "git") {
      // Bound repo id (from the picker) OR a pasted URL. Either is a repo.
      if (!v.gitRepoId.trim() && !v.gitRepoUrl.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Pick a repository or paste a repo URL",
          path: ["gitRepoUrl"],
        });
      }
    } else if (!v.content.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Paste or upload a compose file",
        path: ["content"],
      });
    }
  });

/**
 * The "vars" step's schema, validating the `vars` group's slice. A `${VAR}` with
 * no `:-default` (e.g. Authentik's POSTGRES_PASSWORD) can't be left blank.
 * Otherwise the step is clickable straight through and the stack lands pending
 * with an empty password, the "janky" bypass the required flag exists to stop.
 * Secrets are auto-filled at parse time, so what's usually left is a URL or name
 * only the operator knows.
 */
export const varsStepSchema = z
  .object({
    variables: z.array(varRowSchema),
  })
  .superRefine((v, ctx) => {
    v.variables.forEach((row, i) => {
      if (row.required && row.value.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: "Required. Fill this in before the stack can deploy.",
          path: ["variables", i, "value"],
        });
      }
    });
  });

/**
 * The parent-form schema for `validators.onDynamic`. It is only used when
 * `form.handleSubmit` runs (never when a group's own `handleSubmit` does, per
 * the form-groups guide), so it acts as the bypass net: if a step is skipped,
 * validating the whole form still flags its errors. Composing the two step
 * schemas keeps its input type equal to `ComposeFormValues`, so it too wires on
 * with no cast.
 */
export const composeFormSchema = z.object({
  file: fileStepSchema,
  vars: varsStepSchema,
});

/** The stack's name when the operator leaves the field blank. Shown as the
 *  field placeholder and the base `useUniqueStackName` bumps on collision: the
 *  repo's last path segment for git, the compose file's own `name:` for inline.
 *  A pure display helper (no validation), so it lives here next to the shape it
 *  describes rather than in a flags aggregator. */
export function stackNamePlaceholder(
  source: "inline" | "git",
  gitRepoUrl: string,
  previewName: string | null | undefined,
): string {
  const repoName = gitRepoUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .split("/")
    .pop();
  const candidate = source === "git" ? repoName : previewName;
  return candidate || "compose-stack";
}
