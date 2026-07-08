/**
 * PR previews for the project graph — one entry per open preview with the
 * per-service state the satellite cards render: PR number, branch, and for
 * each opted-in service its latest preview deployment status + preview URL.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { basePath, projectNotFoundErrors, tag } from "./shared";
import { projectIdField, resourceIdField } from "./shared";

const previewIdField = zId(ID_PREFIX.preview);

export const previewServiceSchema = z.object({
  resourceId: resourceIdField,
  /** Base resource name — matches the graph node the card attaches to. */
  serviceName: z.string(),
  /** Latest preview-scoped deployment status; "none" before the first build. */
  status: z.enum(["pending", "building", "running", "failed", "superseded", "removed", "none"]),
  /** Preview host (https URL), when the service is publicly exposed. */
  url: z.string().nullable(),
});

export const previewSchema = z.object({
  id: z.string(),
  prNumber: z.number(),
  /** Plain head branch name (`feat/checkout-v2`). */
  branch: z.string(),
  headSha: z.string(),
  slug: z.string(),
  state: z.enum(["active", "closed"]),
  services: z.array(previewServiceSchema),
});

export const listPreviewsInput = z.object({
  projectId: projectIdField,
});

export const previewEnvVarSchema = z.object({
  key: z.string(),
  value: z.string(),
  updatedAt: z.string(),
});

const previewEnvVarScope = z.object({
  projectId: projectIdField,
  previewId: previewIdField,
  serviceResourceId: resourceIdField,
});

export const previewsContractSlice = {
  list: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/previews`,
      tag,
      method: "GET",
    })
    .input(listPreviewsInput)
    .output(z.array(previewSchema)),

  envVars: {
    list: oc
      .errors(projectNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/previews/{previewId}/env/{serviceResourceId}`,
        tag,
        method: "GET",
      })
      .input(previewEnvVarScope)
      .output(z.array(previewEnvVarSchema)),
    set: oc
      .errors(projectNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/previews/{previewId}/env/{serviceResourceId}/set`,
        tag,
        method: "POST",
      })
      .input(previewEnvVarScope.extend({ key: z.string().min(1), value: z.string() }))
      .output(z.object({ redeployed: z.boolean() })),
    unset: oc
      .errors(projectNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/previews/{previewId}/env/{serviceResourceId}/unset`,
        tag,
        method: "POST",
      })
      .input(previewEnvVarScope.extend({ key: z.string().min(1) }))
      .output(z.object({ redeployed: z.boolean() })),
  },
};
