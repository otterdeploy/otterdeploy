/**
 * Generic resource base inputs + the router slice. Resource *schemas*
 * (database/service/compose + the discriminated union) live in
 * `./resource-schemas`: split out so this file stays under the line cap.
 *
 * The "generic" per-resource endpoints (tasks, env, get, delete, checkName,
 * list) live in this file's contract slice. Handler dispatches on kind to
 * source from the right storage.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { resourceSchema } from "./resource-schemas";
import { basePath, projectNotFoundErrors, resourceNotFoundErrors, tag } from "./shared";

export {
  composeResourceSchema,
  postgresResourceSchema,
  serviceResourceSchema,
} from "./resource-schemas";

const listProjectResourcesInput = z.object({
  projectId: projectIdField,
  /** Which environment's resources to return. Omitted means the project's main
   *  environment: the same default the switcher opens on. */
  environmentId: environmentIdField.optional(),
});

const getProjectResourceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

const deleteProjectResourceInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

/**
 * Generic per-resource endpoints: same shape for postgres databases,
 * services, and any future engine. Handler dispatches on resource kind.
 */
const resourceTaskInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

const resourceEnvEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});

const resourceEnvListInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
});

const resourceEnvBulkSetInput = z.object({
  projectId: projectIdField,
  resourceId: resourceIdField,
  env: z.array(resourceEnvEntrySchema),
  // Keys to mark as sensitive: server stores this as a display hint;
  // values still travel the wire in plain. Optional so callers that don't
  // care about masking can omit it.
  secretKeys: z.array(z.string()).optional(),
  // Whether to re-apply the resource to Swarm after persisting. A container's
  // env is fixed at creation, so the change only takes effect on redeploy.
  // The Variables tab passes `false`. It persists the diff and leaves the
  // running container alone until the operator hits Deploy. Omitted/`true`
  // preserves the eager-redeploy behaviour for the CLI and other callers.
  redeploy: z.boolean().optional(),
});

/**
 * Live name-availability check for the new-resource wizard. Used by the
 * Service name field's onBlur validator and to pre-fill a free default
 * when the page mounts. `suggestion` is non-null only when `available` is
 * false, derived by suffixing "-2", "-3", … until free.
 */
const checkResourceNameInput = z.object({
  projectId: projectIdField,
  name: z.string().min(1),
  /** Environment the resource will be created in. Names collide per
   *  (project, environment). Omitted means main. */
  environmentId: environmentIdField.optional(),
});

const checkResourceNameSchema = z.object({
  available: z.boolean(),
  suggestion: z.string().nullable(),
});

/**
 * Read-only preview of the public hostname a service named `name` would be
 * published at (same resolver chain the expose path walks: resource override
 * → project custom domain → org base → local dev base → sslip fallback).
 * Used by the new-resource wizard so the Networking/Review steps can show,
 * and stage: the real hostname instead of silently dropping the Public
 * toggle. Pure lookup; writes nothing.
 */
const publicHostPreviewInput = z.object({
  projectId: projectIdField,
  name: z.string().min(1),
});

const publicHostPreviewSchema = z.object({
  fqdn: z.string(),
  source: z.enum([
    "resource-override",
    "project-custom",
    "org-base",
    "local-base",
    "sslip-fallback",
  ]),
});

// Imported by the slice below: see ./service-tasks for the schema definition.
import { serviceTaskSchema } from "./service-tasks";
import { environmentIdField, projectIdField, resourceIdField } from "./shared";

/**
 * Router slice for the generic resource endpoints: list, checkName, tasks,
 * env CRUD, get, delete. Composed into `projectContract.resource` along
 * with the streaming logs slice and the postgres-specific sub-slice.
 */
export const resourceContractSlice = {
  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources`,
      tag,
      method: "GET",
    })
    .input(listProjectResourcesInput)
    .output(z.array(resourceSchema)),

  checkName: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/check-name`,
      tag,
      method: "GET",
    })
    .input(checkResourceNameInput)
    .output(checkResourceNameSchema),

  publicHostPreview: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/public-host-preview`,
      tag,
      method: "GET",
    })
    .input(publicHostPreviewInput)
    .output(publicHostPreviewSchema),

  tasks: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}/tasks`,
      tag,
      method: "GET",
    })
    .input(resourceTaskInput)
    .output(z.array(serviceTaskSchema)),

  env: {
    list: oc
      .errors(resourceNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/env`,
        tag,
        method: "GET",
      })
      .input(resourceEnvListInput)
      .output(z.array(resourceEnvEntrySchema)),

    bulkSet: oc
      .errors({
        ...resourceNotFoundErrors,
        // A value the resolver could never satisfy (a service reading its own
        // env bag). The handler's message names the offending key and token.
        INVALID_INPUT: { status: 422, message: "Invalid variable value" as const },
      })
      .meta({
        path: `${basePath}/{projectId}/resources/{resourceId}/env`,
        tag,
        method: "PUT",
      })
      .input(resourceEnvBulkSetInput)
      .output(z.array(resourceEnvEntrySchema)),
  },

  get: oc
    .errors(resourceNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}`,
      tag,
      method: "GET",
    })
    .input(getProjectResourceInput)
    .output(resourceSchema),

  delete: oc
    .errors({
      ...resourceNotFoundErrors,
      // 409: the request is well-formed, the database simply still has live
      // preview branches. Closing them is the resolution, which is what a
      // conflict means, as opposed to a malformed request.
      CONFLICT: {
        status: 409,
        message: "Database still has preview branches" as const,
      },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/{resourceId}`,
      tag,
      method: "DELETE",
    })
    .input(deleteProjectResourceInput)
    .output(z.object({ ok: z.boolean() })),

  // Clone a SET of resources. Preview first: the names the copies get, and
  // every env reference that will still point OUTSIDE the set. The latter is
  // the part worth reading, because a copy holding a ref to a resource you
  // didn't clone reads and writes the original with no visible symptom.
  clonePreview: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Project not found" as const },
      INVALID_INPUT: { status: 400, message: "Select at least one resource" as const },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/clone/preview`,
      tag,
      method: "POST",
    })
    .input(z.object({ projectId: projectIdField, resourceIds: z.array(z.string()).min(1) }))
    .output(
      z.object({
        names: z.array(z.object({ sourceName: z.string(), targetName: z.string() })),
        externalRefs: z.array(
          z.object({ fromName: z.string(), toName: z.string(), envKey: z.string() }),
        ),
      }),
    ),

  clone: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Project not found" as const },
      INVALID_INPUT: { status: 400, message: "Select at least one resource" as const },
    })
    .meta({
      path: `${basePath}/{projectId}/resources/clone`,
      tag,
      method: "POST",
    })
    .input(z.object({ projectId: projectIdField, resourceIds: z.array(z.string()).min(1) }))
    .output(
      z.object({
        created: z.array(
          z.object({
            resourceId: z.string(),
            name: z.string(),
            type: z.enum(["service", "database"]),
          }),
        ),
        // Partial success is real: one bad source must not discard the copies
        // already made, so both lists come back.
        failed: z.array(z.object({ sourceName: z.string(), reason: z.string() })),
        externalRefs: z.array(
          z.object({ fromName: z.string(), toName: z.string(), envKey: z.string() }),
        ),
      }),
    ),
};
