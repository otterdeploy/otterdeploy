/**
 * Manifest contract slice: JSON-native declarative source of truth.
 *
 *   get. Read the project's current manifest + version
 *   save. Replace the manifest (optimistic lock on expectedVersion)
 *   diff: preview the merge result vs current server-side state
 *   apply. Reconcile resources to match the saved manifest
 *
 * `diff` runs the pure `diffManifest` against `loadCurrentState`; `apply`
 * runs the full `applyManifest` reconciler (creates/updates/deletes services,
 * databases, and env; enqueues git builds). See routers/project/index.ts and
 * routers/project/manifest-apply.ts.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { zJsonObject } from "../../../lib/z-json";
import { manifestSchema } from "../../../stack/manifest";
import { getProjectInput } from "./project";
import { basePath, projectNotFoundErrors, tag } from "./shared";

const manifestGetOutput = z.object({
  manifest: manifestSchema.nullable(),
  version: z.number().int().nonnegative(),
});

const manifestSaveInput = z.object({
  projectId: getProjectInput.shape.id,
  manifest: manifestSchema,
  // Monotonic counter; the server bumps it on every save. Pass the
  // version you previously read so concurrent edits surface as CONFLICT
  // instead of silently overwriting.
  expectedVersion: z.number().int().nonnegative(),
});

const manifestSaveOutput = z.object({
  version: z.number().int().nonnegative(),
});

const manifestDiffInput = z.object({
  projectId: getProjectInput.shape.id,
  // Resolve overrides for this environment before diffing. Omit to diff
  // the base manifest as-is.
  environment: z.string().min(1).optional(),
});

const manifestDiffOutput = z.object({
  // The resolved manifest the server would apply if `apply` ran now.
  resolved: manifestSchema.nullable(),
  // High-level changes the apply would make (from `diffManifest`).
  changes: z.array(
    z.object({
      kind: z.enum(["create", "update", "delete", "no-op"]),
      resource: z.enum(["service", "database", "env", "compose"]),
      name: z.string(),
      details: zJsonObject.optional(),
    }),
  ),
});

const manifestApplyInput = z.object({
  projectId: getProjectInput.shape.id,
  environment: z.string().min(1).optional(),
  // Apply only these resources, leaving every other staged edit PENDING.
  // Omitted = apply everything, the original behaviour.
  //
  // Deliberately not the same as `discard({ only })`, which throws the other
  // changes away. Cherry-picking an apply must leave what you didn't pick
  // still staged — a checkbox that silently destroys the unticked rows is how
  // someone loses work they only meant to defer. The excluded changes are fed
  // to the same `skipped` channel a failed create uses, and
  // `snapshotAfterApply` already reverts anything skipped, so they survive
  // into the next diff with no extra bookkeeping.
  only: z
    .array(
      z.object({
        resource: z.enum(["service", "database", "env", "compose"]),
        name: z.string().min(1),
      }),
    )
    .optional(),
});

const manifestApplyOutput = z.object({
  appliedCount: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      resource: z.enum(["service", "database", "env", "compose"]),
      name: z.string(),
      reason: z.string(),
    }),
  ),
  lastAppliedAt: z.string(),
});

// discard: undo pending changes. Resets the saved manifest to the
// most recent successfully-applied snapshot (the `lastAppliedManifest`
// column on the project row). After discard, manifest == current state
// and the pending-changes bar disappears.
const manifestDiscardInput = z.object({
  projectId: getProjectInput.shape.id,
  // Discard only these resources, leaving every other staged edit alone.
  // Omitted = discard everything, the original behaviour. Lets the pending-
  // changes bar drop one unwanted change without also throwing away the
  // edits the operator still wants.
  only: z
    .array(
      z.object({
        resource: z.enum(["service", "database", "env", "compose"]),
        name: z.string().min(1),
      }),
    )
    .optional(),
});

const manifestDiscardOutput = z.object({
  version: z.number().int().nonnegative(),
});

// The manifest's own key grammar, PLUS a trailing-hyphen ban.
//
// `resourceName` in stack/manifest/schema.ts accepts a trailing hyphen, and
// that gap is how `mariadb-` entered a live manifest: the name validates here,
// but `sanitizeDatabaseName` strips the hyphen when deriving Docker names, so
// it collides with an existing `mariadb` and the create fails forever. A
// rename must not be able to mint another one.
const renameTarget = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/, {
    message: "Use lowercase letters, digits and hyphens; start with a letter.",
  })
  .refine((name) => !name.endsWith("-"), {
    message: "Names can't end with a hyphen.",
  });

const manifestRenameInput = z.object({
  projectId: getProjectInput.shape.id,
  resource: z.enum(["service", "database", "compose"]),
  from: z.string().min(1),
  to: renameTarget,
});

const manifestRenameOutput = z.object({
  version: z.number().int().nonnegative(),
});

// applyChange: atomic save + apply. Single round-trip for the common
// "I edited the manifest, deploy it now" flow. The CLI's `sync` and
// the UI's "Deploy" both call this; no daylight between the two paths.
// `save` + `apply` remain for the stack editor's "preview then deploy"
// flow where the user wants to inspect the diff before reconciling.
const manifestApplyChangeInput = z.object({
  projectId: getProjectInput.shape.id,
  manifest: manifestSchema,
  expectedVersion: z.number().int().nonnegative(),
  environment: z.string().min(1).optional(),
});

const manifestApplyChangeOutput = z.object({
  version: z.number().int().nonnegative(),
  appliedCount: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      resource: z.enum(["service", "database", "env", "compose"]),
      name: z.string(),
      reason: z.string(),
    }),
  ),
  lastAppliedAt: z.string(),
});

const manifestExportInput = z.object({
  projectId: getProjectInput.shape.id,
});

const manifestExportOutput = z.object({
  yaml: z.string(),
});

const conflict = {
  CONFLICT: {
    status: 409,
    message: "Manifest was modified concurrently. Refresh and retry." as const,
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
  applyChange: oc
    .errors({ ...projectNotFoundErrors, ...conflict })
    .meta({ path: `${basePath}/{projectId}/manifest/apply-change`, tag, method: "POST" })
    .input(manifestApplyChangeInput)
    .output(manifestApplyChangeOutput),
  discard: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{projectId}/manifest/discard`, tag, method: "POST" })
    .input(manifestDiscardInput)
    .output(manifestDiscardOutput),
  // rename: move a resource's manifest key and rewrite every ref that
  // addressed it (`${database:old.url}` → `${database:new.url}`). Only for
  // resources that are still PENDING: once deployed, the container, swarm
  // service and volume names are derived from the resource name, so a rename
  // would point the project at infrastructure that doesn't exist.
  rename: oc
    .errors({
      ...projectNotFoundErrors,
      // Every refusal a rename can hit is the operator's to fix: the resource
      // is already deployed, the target name is taken, or the manifest moved
      // under them. The handler supplies the specific message.
      BAD_REQUEST: { status: 400, message: "Rename rejected" as const },
    })
    .meta({ path: `${basePath}/{projectId}/manifest/rename`, tag, method: "POST" })
    .input(manifestRenameInput)
    .output(manifestRenameOutput),
  // One-way render of the current resource graph as a deployable
  // docker-compose stack file. Disaster-recovery / local-dev / audit
  // escape hatch; not a roundtrip: secret values are resolved in the
  // output and ${database:…} / ${service:…} refs are inlined.
  export: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{projectId}/manifest/compose`, tag, method: "GET" })
    .input(manifestExportInput)
    .output(manifestExportOutput),
};
