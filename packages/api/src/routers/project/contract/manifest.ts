/**
 * Manifest contract slice — JSON-native declarative source of truth.
 *
 *   get     — read the project's current manifest + version
 *   save    — replace the manifest (optimistic lock on expectedVersion)
 *   diff    — preview the merge result vs current server-side state
 *   apply   — reconcile resources to match the saved manifest
 *
 * `apply` and `diff` ship as stubs in Phase 3 and gain the full
 * reconciler in Phase 4.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { manifestSchema } from "../../../stack/manifest";
import { basePath, projectNotFoundErrors, tag } from "./shared";
import { getProjectInput } from "./project";

export const manifestGetOutput = z.object({
  manifest: manifestSchema.nullable(),
  version: z.number().int().nonnegative(),
});

export const manifestSaveInput = z.object({
  projectId: getProjectInput.shape.id,
  manifest: manifestSchema,
  // Monotonic counter; the server bumps it on every save. Pass the
  // version you previously read so concurrent edits surface as CONFLICT
  // instead of silently overwriting.
  expectedVersion: z.number().int().nonnegative(),
});

export const manifestSaveOutput = z.object({
  version: z.number().int().nonnegative(),
});

export const manifestDiffInput = z.object({
  projectId: getProjectInput.shape.id,
  // Resolve overrides for this environment before diffing. Omit to diff
  // the base manifest as-is.
  environment: z.string().min(1).optional(),
});

export const manifestDiffOutput = z.object({
  // The resolved manifest the server would apply if `apply` ran now.
  resolved: manifestSchema.nullable(),
  // High-level changes the apply would make. Phase 4 fills this in;
  // Phase 3 returns an empty array.
  changes: z.array(
    z.object({
      kind: z.enum(["create", "update", "delete", "no-op"]),
      resource: z.enum(["service", "database", "env"]),
      name: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export const manifestApplyInput = z.object({
  projectId: getProjectInput.shape.id,
  environment: z.string().min(1).optional(),
});

export const manifestApplyOutput = z.object({
  appliedCount: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      resource: z.enum(["service", "database", "env"]),
      name: z.string(),
      reason: z.string(),
    }),
  ),
  lastAppliedAt: z.string(),
});

const conflict = {
  CONFLICT: {
    status: 409,
    message: "Manifest was modified concurrently — refresh and retry." as const,
  },
};

export const manifestContractSlice = {
  get: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{projectId}/manifest`, tag, method: "GET" })
    .input(getProjectInput)
    .output(manifestGetOutput),
  save: oc
    .errors({ ...projectNotFoundErrors, ...conflict })
    .meta({ path: `${basePath}/{projectId}/manifest`, tag, method: "PUT" })
    .input(manifestSaveInput)
    .output(manifestSaveOutput),
  diff: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{projectId}/manifest/diff`, tag, method: "POST" })
    .input(manifestDiffInput)
    .output(manifestDiffOutput),
  apply: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{projectId}/manifest/apply`, tag, method: "POST" })
    .input(manifestApplyInput)
    .output(manifestApplyOutput),
};
