/**
 * URL-backed filter state for the project-wide Deployments page, plus the
 * client-side row type for `deployment.listByProject`. Filters live in search
 * params so a filtered view is shareable and survives reload (same idiom as
 * the Logs page).
 */

import * as z from "zod";

export const DEPLOY_WINDOWS = [
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
] as const;

export type DeployWindow = (typeof DEPLOY_WINDOWS)[number]["id"];

const WINDOW_MS: Record<Exclude<DeployWindow, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** ISO lower bound for a window, or undefined for "all". */
export function windowSince(window: DeployWindow): string | undefined {
  if (window === "all") return undefined;
  return new Date(Date.now() - WINDOW_MS[window]).toISOString();
}

/**
 * UI status vocabulary → API effective-status filter. "Replaced" is the
 * user-facing word for `superseded` (matches the badge label); "Building"
 * covers stored `pending` too, the API expands it.
 */
export const DEPLOY_STATUS_FILTERS = [
  { id: "running", label: "Running", api: "running" },
  { id: "failed", label: "Failed", api: "failed" },
  { id: "building", label: "Building", api: "building" },
  { id: "replaced", label: "Replaced", api: "superseded" },
  { id: "removed", label: "Removed", api: "removed" },
] as const;

export type DeployStatusFilter = (typeof DEPLOY_STATUS_FILTERS)[number]["id"];

export function statusFilterToApi(
  id: DeployStatusFilter,
): (typeof DEPLOY_STATUS_FILTERS)[number]["api"] {
  const found = DEPLOY_STATUS_FILTERS.find((s) => s.id === id);
  return found?.api ?? "running";
}

/** Rows-per-page choices, same set the data studio's footer offers. */
export const DEPLOY_PAGE_SIZES = [50, 100, 200, 500] as const;
export type DeployPageSize = (typeof DEPLOY_PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: DeployPageSize = 50;

/** The URL holds ALL of this page's state: filters, search, and pagination.
 *  Every field renders a clean default when undefined, so a pristine visit
 *  keeps a bare URL while any touched control becomes shareable. */
export const zDeploymentsSearch = z.object({
  /** Resource id of a single resource, or undefined for all. */
  service: z.string().optional(),
  status: z.enum(["running", "failed", "building", "replaced", "removed"]).optional(),
  /** Time window; undefined renders as the 7d default (keeps the URL clean). */
  window: z.enum(["24h", "7d", "30d", "all"]).optional(),
  /** Free-text search over sha / commit message / author / resource / image. */
  q: z.string().optional(),
  /** Environment id; undefined = all environments. */
  environment: z.string().optional(),
  /** 1-based page; undefined renders as page 1. */
  page: z.number().int().min(1).optional(),
  /** Rows per page; undefined renders as the 50 default. */
  size: z.union([z.literal(50), z.literal(100), z.literal(200), z.literal(500)]).optional(),
});

export type DeploymentsSearch = z.infer<typeof zDeploymentsSearch>;

/** One row of `deployment.listByProject`: mirrors the contract's
 *  `projectDeploymentListItemSchema` (same status/reason vocabulary as the
 *  per-resource deployments list). */
export interface ProjectDeployment {
  id: string;
  projectId: string;
  resourceId: string;
  resourceName: string;
  resourceKind: "database" | "service" | "compose";
  /** Display name of the environment the resource lives in (main resolved
   *  server-side for NULL-stamped rows). */
  environmentName: string;
  image: string;
  reason:
    | "create"
    | "redeploy"
    | "env-change"
    | "image-change"
    | "restart"
    | "git-push"
    | "rollback";
  status:
    | "pending"
    | "building"
    | "starting"
    | "running"
    | "crashed"
    | "paused"
    | "failed"
    | "cancelled"
    | "superseded"
    | "removed";
  errorMessage: string | null;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  /** Content hash of an uploaded source tarball (source:"upload"): the upload
   *  analog of gitSha. Null for git / image deploys. */
  sourceSha: string | null;
  isLatest: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Headline figures for the stats strip. Mirrors the contract's
 *  `projectDeploymentStatsSchema`: computed over every filter EXCEPT status
 *  (the strip keeps describing the window while the status select narrows
 *  the table). */
export interface ProjectDeploymentStats {
  windowTotal: number;
  failed: number;
  inFlight: number;
  medianDurationMs: number | null;
}

/**
 * Can this row be rolled back to? Mirrors `isRollbackable` in
 * `features/resources/components/_shared/history-row-menu.tsx`: a settled
 * successful deploy with a real built image. Plus the project-list extras:
 * only services roll back (the mutation is `service.rollback`) and never the
 * resource's newest deployment (there is nothing newer to roll back *from*).
 */
export function isRollbackEligible(d: ProjectDeployment): boolean {
  return (
    d.resourceKind === "service" &&
    !d.isLatest &&
    (d.status === "running" || d.status === "superseded") &&
    !!d.image &&
    !d.image.startsWith("pending:")
  );
}
