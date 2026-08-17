/**
 * Project-wide deployment feed: the cross-resource complement to
 * `project.resource.deployments.list` (which is scoped to one resource).
 * One row per deploy across every base resource in the project, newest
 * first, with the resource's name/kind joined in so the table can render
 * without N follow-up reads.
 *
 * Reuses `deploymentSchema` field-for-field (same status/reason vocabulary);
 * only the live task-derived counts are dropped. Task counts and restart
 * counts would require a docker round-trip per resource on every poll and the
 * per-resource tab already surfaces them.
 */

import { oc } from "@orpc/contract";
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import * as z from "zod";

import { deploymentSchema } from "../project/contract/deployments";
import {
  basePath,
  deploymentIdField,
  projectIdField,
  projectNotFoundErrors,
  resourceIdField,
  tag,
} from "../project/contract/shared";

const projectDeploymentListItemSchema = deploymentSchema
  .omit({
    taskCount: true,
    failedTaskCount: true,
    runningTaskCount: true,
    restartCount: true,
    restartMaxAttempts: true,
  })
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
 * those as replaced: see `effectiveListedStatus`). The derived-only
 * `crashed`/`starting` states aren't filterable; they refine `running`/
 * `building` rows at render time.
 */
const statusFilterField = z.enum([
  "building",
  "running",
  "failed",
  "cancelled",
  "superseded",
  "removed",
]);

const listDeploymentsByProjectInput = z.object({
  projectId: projectIdField,
  /** Scope to one resource's deployments. Omitted → whole project. */
  resourceId: resourceIdField.optional(),
  status: statusFilterField.optional(),
  /** Only deployments created at/after this instant. Omitted → all time. */
  since: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const listDeploymentsByProjectOutput = z.object({
  items: z.array(projectDeploymentListItemSchema),
  /** Total rows matching the filters (ignores `limit`): powers "N of M". */
  total: z.number().int().nonnegative(),
});

/**
 * Org-wide in-flight work. Counts are over ALL matching rows, `items` is capped
 * by `limit`, so a header pill can say "23 queued" while the popover lists the
 * first page, rather than under-reporting to whatever fits on screen.
 */
const deployActivityOutput = z.object({
  items: z.array(
    z.object({
      id: deploymentIdField,
      resourceId: resourceIdField,
      resourceName: z.string(),
      projectId: projectIdField,
      // Branded, not bare `string`: this feeds route params, and the brand is
      // what stops an org slug being passed where a project slug belongs.
      projectSlug: zSlug(ID_PREFIX.project),
      projectName: z.string(),
      status: z.enum(["pending", "building"]),
      reason: z.string(),
      gitRef: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  building: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  /** Queued work with no active build consuming it, on ANY lane — every
   *  builder is down. */
  builderStalled: z.boolean(),
  /**
   * Per-deploy-lane queue occupancy (packages/jobs/src/lanes.ts). Single-lane
   * installs see just "default"; multi-builder installs get one entry per
   * lane so the UI can say where a backlog lives. Optional: omitted when the
   * queue backend can't be read, and only computed while a backlog exists.
   */
  lanes: z
    .array(
      z.object({
        lane: z.string(),
        active: z.number().int().nonnegative(),
        queued: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

export const deploymentContract = {
  /**
   * What is queued or building across the whole org, right now. Polled by the
   * header activity indicator, which is why it is deliberately cheap: no docker
   * round-trips, no snapshot column, no history.
   */
  activity: oc
    .meta({
      path: `${basePath}/activity`,
      tag,
      method: "GET",
    })
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .output(deployActivityOutput),

  /**
   * Stop an in-flight build. 404 covers "no such deployment" and "not your
   * org" alike; 409 is the honest answer for a deploy that already settled.
   * Including one that settled in the moment between the click and the write.
   */
  cancel: oc
    .errors({
      NOT_FOUND: { status: 404 as const, message: "Deployment not found" as const },
      CONFLICT: { status: 409 as const, message: "Deployment is not in flight" as const },
    })
    .meta({
      path: `${basePath}/deployments/{deploymentId}/cancel`,
      tag,
      method: "POST",
    })
    .input(z.object({ deploymentId: deploymentIdField }))
    .output(
      z.object({
        id: deploymentIdField,
        status: z.literal("cancelled"),
        killedHelper: z.boolean(),
        dequeued: z.boolean(),
      }),
    ),

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
