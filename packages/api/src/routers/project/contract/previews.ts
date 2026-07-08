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

const previewScopeOnly = z.object({ projectId: projectIdField, previewId: previewIdField });

/** A preview-level POST control (rebuild/pause/etc.) — scope in, loose ok out. */
function previewAction(path: string) {
  return oc
    .errors(projectNotFoundErrors)
    .meta({ path, tag, method: "POST" })
    .input(previewScopeOnly)
    .output(z.record(z.string(), z.union([z.number(), z.boolean()])));
}

export const previewServiceSchema = z.object({
  resourceId: resourceIdField,
  /** Base resource name — matches the graph node the card attaches to. */
  serviceName: z.string(),
  /** Latest preview-scoped deployment status; "none" before the first build. */
  status: z.enum(["pending", "building", "running", "failed", "superseded", "removed", "none", "paused"]),
  /** Preview host (https URL), when the service is publicly exposed. */
  url: z.string().nullable(),
  /** Full commit sha currently RUNNING for this service; null before live. */
  deployedSha: z.string().nullable(),
});

export const previewSchema = z.object({
  id: z.string(),
  prNumber: z.number(),
  /** Plain head branch name (`feat/checkout-v2`). */
  branch: z.string(),
  headSha: z.string(),
  slug: z.string(),
  state: z.enum(["active", "closed"]),
  paused: z.boolean(),
  /** ISO instant the preview is idle-reaped, or null when pinned (keep-alive). */
  autoTeardownAt: z.string().nullable(),
  /** True when this preview owns isolated DB branches (vs sharing the base). */
  dbBranched: z.boolean(),
  /** Platform DBs the preview's services connect to; branch control shown when >0. */
  branchableDbCount: z.number(),
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

  rebuild: previewAction(`${basePath}/{projectId}/previews/{previewId}/rebuild`),
  redeploy: previewAction(`${basePath}/{projectId}/previews/{previewId}/redeploy`),
  pause: previewAction(`${basePath}/{projectId}/previews/{previewId}/pause`),
  resume: previewAction(`${basePath}/{projectId}/previews/{previewId}/resume`),
  teardown: previewAction(`${basePath}/{projectId}/previews/{previewId}/teardown`),
  keepAlive: oc
    .errors(projectNotFoundErrors)
    .meta({ path: `${basePath}/{projectId}/previews/{previewId}/keep-alive`, tag, method: "POST" })
    // keepAlive=true pins (never idle-reaped); false re-arms the SERVER default
    // TTL (or stays unpinned when idle teardown is globally disabled).
    .input(previewScopeOnly.extend({ keepAlive: z.boolean() }))
    .output(z.object({ pinned: z.boolean() })),
  dbBranch: {
    enable: previewAction(`${basePath}/{projectId}/previews/{previewId}/db-branch/enable`),
    disable: previewAction(`${basePath}/{projectId}/previews/{previewId}/db-branch/disable`),
    reset: previewAction(`${basePath}/{projectId}/previews/{previewId}/db-branch/reset`),
  },

  envVars: {
    effective: oc
      .errors(projectNotFoundErrors)
      .meta({
        path: `${basePath}/{projectId}/previews/{previewId}/env/{serviceResourceId}/effective`,
        tag,
        method: "GET",
      })
      .input(previewEnvVarScope)
      .output(
        z.array(
          z.object({
            key: z.string(),
            value: z.string(),
            source: z.enum(["inherited", "override"]),
            baseValue: z.string().nullable(),
            isSecret: z.boolean(),
            unresolved: z.boolean(),
          }),
        ),
      ),
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
