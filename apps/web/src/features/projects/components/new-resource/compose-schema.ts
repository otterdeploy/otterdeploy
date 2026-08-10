/**
 * Schema-owned validation for the Compose create wizard — the compose flow's
 * answer to the resource wizard's `schemas/` union (see ./schemas/index.ts and
 * ./wizard-form.ts for the pattern this mirrors).
 *
 * One zod schema keyed on the `__step` discriminator drives every "can this
 * step advance?" decision. The form always holds the full flat value shape; the
 * schema's `superRefine` switches on `__step` so the checks that run are exactly
 * the ones for the step the operator is looking at. This replaces the
 * hand-rolled `deriveComposeFlags` booleans (isInlineReady / hasUnsetRequiredVars
 * / showNext / canCreate / requiredUnset) that used to live in
 * compose-wizard-shared.ts.
 *
 * It's a single `z.object` (branched by hand) rather than a `discriminatedUnion`
 * on purpose: a union's input type is the union of its arms, which no longer
 * matches the form's flat `ComposeFormValues`, and wiring it as the form
 * validator would then need an `as any` the lint (assertionStyle: never)
 * rejects. A refined object's input type IS the flat shape, so it drops onto
 * `validators.onChange` with no cast.
 *
 * Two steps:
 *   - "file": pick a source. Inline needs pasted content; git needs a repo.
 *     Whether inline content is *deployable* (parsed clean, no `build:`
 *     service) is decided by the async `content` field validator in
 *     compose-wizard-parse.ts — a field error, not a schema rule, because that
 *     verdict comes from the server parse and can't be seen in the form values.
 *   - "vars": every REQUIRED `${VAR}` (declared with no `:-default`) must have
 *     a value before the stack can stage.
 */

import * as z from "zod";

import type { Var } from "./form-fields/variables-field";

/** The wizard's two steps. Inline flows file → vars; git has only the file
 *  step (its file + vars are resolved at build time, not in this dialog). */
export type ComposeStep = "file" | "vars";

/** Flat shape the form stores. The union narrows per step when validating, but
 *  the form always holds every field — mirrors ResourceFormState. */
export interface ComposeFormValues {
  /** Discriminator the union switches on; changes with the step, in the handler
   *  that changes the step (goToStep), so the two never drift. */
  __step: ComposeStep;
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

export const composeDefaults: ComposeFormValues = {
  __step: "file",
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
};

// A single `${VAR}` row. `required` is the "declared with no `:-default`" flag
// the parse seeds onto each row (compose-wizard-parse.ts) — the vars arm hangs
// its whole "is this complete?" question off it.
const varRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  secret: z.boolean(),
  required: z.boolean().optional(),
});

// Declares every field the form holds so the schema's INPUT type equals the
// flat ComposeFormValues — that exact match is what lets it wire onto the form's
// `validators.onChange` with no cast. Most fields are unconstrained here (their
// own field-level validators, or none, own them); the step gating lives in the
// superRefine below.
export const composeFormSchema = z
  .object({
    __step: z.enum(["file", "vars"]),
    name: z.string(),
    source: z.enum(["inline", "git"]),
    content: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    gitRepoId: z.string(),
    repoFullName: z.string(),
    gitRepoUrl: z.string(),
    gitRef: z.string(),
    composePath: z.string(),
    sourceSubdir: z.string(),
    exposed: z.array(z.string()),
    variables: z.array(varRowSchema),
  })
  .superRefine((v, ctx) => {
    if (v.__step === "file") {
      // File step. Only assert "there is *a* source to work with"; the
      // deployability of inline content (parsed clean, no `build:` service) is
      // the async `content` field validator's verdict, not a schema rule —
      // that comes from the server parse and can't be seen in the form values.
      if (v.source === "git") {
        // Bound repo id (from the picker) OR a pasted URL — either is a repo.
        if (!v.gitRepoId.trim() && !v.gitRepoUrl.trim()) {
          ctx.addIssue({
            code: "custom",
            message: "Pick a repository or paste a repo URL",
            path: ["gitRepoUrl"],
          });
        }
      } else if (!v.content.trim()) {
        ctx.addIssue({ code: "custom", message: "Paste or upload a compose file", path: ["content"] });
      }
      return;
    }
    // Vars step. A `${VAR}` with no `:-default` (e.g. Authentik's
    // POSTGRES_PASSWORD) can't be left blank — otherwise the step is clickable
    // straight through and the stack lands pending with an empty password, the
    // "janky" bypass the required flag exists to stop. Secrets are auto-filled
    // at parse time, so what's usually left is a URL or name only the operator
    // knows.
    v.variables.forEach((row, i) => {
      if (row.required && row.value.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: "Required — fill this in before the stack can deploy",
          path: ["variables", i, "value"],
        });
      }
    });
  });

/** The stack's name when the operator leaves the field blank — shown as the
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
