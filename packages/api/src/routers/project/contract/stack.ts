/**
 * Stack-file contract slice.
 *
 * `diff` is read-only — calls the renderer over current rows and returns
 * the YAML + a unified diff vs the saved stackFile.
 * `save` writes a YAML blob to the project's stackFile column with an
 * optimistic-lock check on stackFileVersion.
 * `apply` reads the saved stackFile, parses it, and pushes the env-var
 * changes through the existing database extra-env mutator so the running
 * swarm services pick up the new values. Other fields (image, ports,
 * healthcheck, new services) are not yet apply-driven — they still flow
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
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/stack/save`,
      tag,
      method: "POST",
    })
    .input(stackSaveInput)
    .output(stackSaveOutput),
  apply: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/stack/apply`,
      tag,
      method: "POST",
    })
    .input(stackApplyInput)
    .output(stackApplyResultSchema),
};
