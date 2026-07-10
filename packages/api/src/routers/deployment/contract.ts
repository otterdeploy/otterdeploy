/**
 * Project-wide deployment feed — the cross-resource complement to
 * `project.resource.deployments.list` (which is scoped to one resource).
 * One row per deploy across every base resource in the project, newest
 * first, with the resource's name/kind joined in so the table can render
 * without N follow-up reads.
 *
 * Reuses `deploymentSchema` field-for-field (same status/reason vocabulary);
 * only the live task counts are dropped — they'd require a docker round-trip
 * per resource on every poll and the per-resource tab already surfaces them.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { deploymentSchema } from "../project/contract/deployments";
import {
  basePath,
  projectIdField,
  projectNotFoundErrors,
  resourceIdField,
  tag,
} from "../project/contract/shared";

export const projectDeploymentListItemSchema = deploymentSchema
  .omit({ taskCount: true, failedTaskCount: true, runningTaskCount: true })
  .extend({
    resourceName: z.string(),
    resourceKind: z.enum(["database", "service", "compose"]),
    /** Is this the resource's newest base deployment? Drives rollback
     *  eligibility client-side (only non-latest settled deploys roll back). */
    isLatest: z.boolean(),
  });

/**
 * Effective-status filter. Matches the status the list *shows*, not the raw
 * stored row: `building` also matches stored `pending` (both render as
 * in-flight), and `superseded` additionally matches any non-latest row whose
 * stored status never settled past running/building/pending (the list shows
 * those as replaced — see `effectiveListedStatus`). The derived-only
 * `crashed`/`starting` states aren't filterable; they refine `running`/
 * `building` rows at render time.
 */
const statusFilterField = z.enum(["building", "running", "failed", "superseded", "removed"]);

export const listDeploymentsByProjectInput = z.object({
  projectId: projectIdField,
  /** Scope to one resource's deployments. Omitted → whole project. */
  resourceId: resourceIdField.optional(),
  status: statusFilterField.optional(),
  /** Only deployments created at/after this instant. Omitted → all time. */
  since: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listDeploymentsByProjectOutput = z.object({
  items: z.array(projectDeploymentListItemSchema),
  /** Total rows matching the filters (ignores `limit`) — powers "N of M". */
  total: z.number().int().nonnegative(),
});

export const deploymentContract = {
  listByProject: oc
    .errors(projectNotFoundErrors)
    .meta({
      path: `${basePath}/{projectId}/deployments`,
      tag,
      method: "GET",
    })
    .input(listDeploymentsByProjectInput)
    .output(listDeploymentsByProjectOutput),
};
