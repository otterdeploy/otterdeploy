/**
 * Shared types + the form hook for the Compose wizard. Split out of
 * compose-wizard.tsx to keep that file + its main component under the line
 * caps.
 *
 * Validation lives next door in ./compose-schema.ts: one zod schema per step,
 * each validating its own slice of the nested form value (`file` / `vars`),
 * wired through `<form.FormGroup>` (see compose-wizard-body.tsx). This file is
 * the preview/detection types the parse hook + chrome share, plus
 * `useComposeForm`, which wires the parent-form schema onto the form.
 */

import { omitUndefined } from "@otterdeploy/shared/object";
import { revalidateLogic } from "@tanstack/react-form";

import { composeDefaults, composeFormSchema, type ComposeFormValues } from "./compose-schema";
import { useAppForm } from "./form-context";

export type { ComposeFormValues } from "./compose-schema";

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

/** Seed for the wizard when a stack arrives from the templates gallery:
 *  display name + the template's compose YAML. The wizard parses the content
 *  through the normal preview path, so the operator still reviews services
 *  and `${VAR}` values before anything is staged. */
export interface ComposePrefill {
  name: string;
  content: string;
  /** SvglLogo search string from the template, persisted on the stack so the
   *  graph node shows the template's brand mark. */
  logoBrand?: string;
  /** Supporting files the template ships alongside the compose file. Seeded
   *  into the `file.files` rows so the wizard's normal multi-file path stages
   *  them — the operator sees and can edit them before anything deploys. */
  files?: Array<{ path: string; content: string; interpolate?: boolean }>;
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

/**
 * The wizard form, schema-owned like the resource wizard's `useWizardForm`.
 *
 * A template handoff seeds `file.name` + `file.content` through `defaultValues`
 * (not an effect): the initial parse then runs off the `content` field's
 * `onMount` listener in compose-wizard-fields.tsx, exactly as if the operator
 * had pasted the file.
 *
 * `validationLogic: revalidateLogic()` is what makes the per-step `onDynamic`
 * schemas on the FormGroups behave (see the form-groups guide): each group runs
 * its own schema off its own `submissionAttempts`, and the parent-form
 * `onDynamic` here is only the bypass net for a whole-form `handleSubmit`. It
 * does NOT intercept the `content`/`composePath` fields' own async validators.
 * Those have no `onDynamic` key, so revalidateLogic runs them normally and the
 * live parse-on-type is untouched.
 */
export function useComposeForm(prefill?: ComposePrefill) {
  // `composeDefaults` carries the full nested typed shape, so the spread infers
  // ComposeFormValues without a cast; a prefill only overrides the `file`
  // group's name, content and supporting files.
  //
  // omitUndefined rather than a conditional spread: with no prefill every key
  // is undefined and drops out, and a prefill that ships no `files` leaves
  // `composeDefaults.file.files` standing on its own — so neither case needs a
  // fallback written out.
  const defaultValues: ComposeFormValues = {
    ...composeDefaults,
    file: {
      ...composeDefaults.file,
      ...omitUndefined({
        name: prefill?.name,
        content: prefill?.content,
        files: prefill?.files,
      }),
    },
  };
  return useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: composeFormSchema },
  });
}

export type ComposeForm = ReturnType<typeof useComposeForm>;
