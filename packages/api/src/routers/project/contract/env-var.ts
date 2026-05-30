/**
 * Project-scoped env var contract. One row per
 * (projectId, environmentId, key) — the storage shape on the
 * `projectEnvVar` table. The frontend Variables page (overview matrix
 * + per-env table + bulk-edit dialog) reads/writes through this slice.
 *
 * Values are returned in plaintext; masking happens client-side
 * (see `isSecret`). Server-side encryption-at-rest is a Plan 7 follow-up
 * that doesn't change this wire shape.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import {
  basePath,
  environmentIdField,
  projectIdField,
  projectNotFoundErrors,
  tag,
} from "./shared";

export const projectEnvVarSchema = z.object({
  id: z.string(),
  projectId: projectIdField,
  environmentId: environmentIdField,
  key: z.string(),
  value: z.string(),
  isSecret: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const listProjectEnvVarsInput = z.object({
  projectId: projectIdField,
  environmentId: environmentIdField,
});

export const upsertProjectEnvVarInput = z.object({
  projectId: projectIdField,
  environmentId: environmentIdField,
  key: z.string().min(1).max(255),
  value: z.string(),
  isSecret: z.boolean().optional(),
});

export const deleteProjectEnvVarInput = z.object({
  projectId: projectIdField,
  environmentId: environmentIdField,
  key: z.string().min(1).max(255),
});

export const bulkReplaceProjectEnvVarsInput = z.object({
  projectId: projectIdField,
  environmentId: environmentIdField,
  vars: z.array(
    z.object({
      key: z.string().min(1).max(255),
      value: z.string(),
      isSecret: z.boolean().optional(),
    }),
  ),
});

export const projectEnvVarContractSlice = {
  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/env-vars`,
      tag,
      method: "GET",
    })
    .input(listProjectEnvVarsInput)
    .output(z.array(projectEnvVarSchema)),

  upsert: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/env-vars`,
      tag,
      method: "PUT",
    })
    .input(upsertProjectEnvVarInput)
    .output(projectEnvVarSchema),

  delete: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/env-vars/{key}`,
      tag,
      method: "DELETE",
    })
    .input(deleteProjectEnvVarInput)
    .output(z.object({ ok: z.boolean() })),

  bulkReplace: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/env-vars/bulk`,
      tag,
      method: "PUT",
    })
    .input(bulkReplaceProjectEnvVarsInput)
    .output(z.array(projectEnvVarSchema)),
};
