/**
 * Stack-file contract slice.
 *
 * `diff` is read-only. Calls the renderer over current rows and returns
 * the YAML + a unified diff vs the saved stackFile.
 * `save` writes a YAML blob to the project's stackFile column with an
 * optimistic-lock check on stackFileVersion.
 * `apply` reads the saved stackFile, parses it, and pushes the env-var
 * changes through the existing database extra-env mutator so the running
 * swarm services pick up the new values. Other fields (image, ports,
 * healthcheck, new services) are not yet apply-driven, they still flow
 * through resource CRUD.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField } from "./shared";

const stackDiffInput = z.object({
  projectId: projectIdField,
});

const stackDiffOutput = z.object({
  renderedYaml: z.string(),
  savedYaml: z.string().nullable(),
  diff: z.string(),
});

const stackSaveInput = z.object({
  projectId: projectIdField,
  yaml: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
});

const stackSaveOutput = z.object({
  version: z.number().int().nonnegative(),
});

const stackApplyInput = z.object({
  projectId: projectIdField,
});

const stackApplyResultSchema = z.object({
  appliedCount: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      service: z.string(),
      reason: z.string(),
    }),
  ),
  lastAppliedAt: z.string(),
});

/** The saved YAML is not a stack file (unparseable, or the wrong shape): the
 *  caller's input, so a 400, never the 500 an untyped throw made it. */
const invalidStackErrors = {
  INVALID_STACK: { status: 400 as const, message: "The stack file is not valid." as const },
};

/** Someone saved since the caller read the version (optimistic lock). */
const stackConflictErrors = {
  CONFLICT: {
    status: 409 as const,
    message: "The stack file changed since you loaded it." as const,
  },
};

/** `apply` before any `save`: nothing to apply. */
const stackNotSavedErrors = {
  STACK_NOT_SAVED: {
    status: 409 as const,
    message: "Save a stack file before applying it." as const,
  },
};

export const stackContractSlice = {
  diff: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/stack/diff`,
      tag,
      method: "GET",
    })
    .input(stackDiffInput)
    .output(stackDiffOutput),
  save: oc
    .errors({ ...projectNotFoundErrors, ...invalidStackErrors, ...stackConflictErrors })
    .meta({
      path: `${basePath}/{projectId}/stack/save`,
      tag,
      method: "POST",
    })
    .input(stackSaveInput)
    .output(stackSaveOutput),
  apply: oc
    .errors({ ...projectNotFoundErrors, ...stackNotSavedErrors })
    .meta({
      path: `${basePath}/{projectId}/stack/apply`,
      tag,
      method: "POST",
    })
    .input(stackApplyInput)
    .output(stackApplyResultSchema),
};
