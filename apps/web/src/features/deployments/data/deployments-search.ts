/**
 * URL-backed state for the project Deployments page, plus the client-side
 * types for `deployment.listByProject`. Every filter lives in search params, so
 * a filtered view is shareable and survives reload (same idiom as the Logs
 * page); a pristine visit keeps a bare URL.
 */

import { Temporal } from "@otterdeploy/shared/temporal";
import * as z from "zod";

export const DEPLOY_WINDOWS = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 7 * 24 },
  { id: "30d", label: "Last 30 days", hours: 30 * 24 },
  { id: "all", label: "All time", hours: null },
] as const;

export type DeployWindow = (typeof DEPLOY_WINDOWS)[number]["id"];

export function windowLabel(window: DeployWindow): string {
  return DEPLOY_WINDOWS.find((w) => w.id === window)?.label ?? "All time";
}

/** ISO lower bound for a window, or undefined for "all". Read at fetch time,
 *  so a page left open keeps a window that ends now. */
export function windowSince(
  window: DeployWindow,
  now = Temporal.Now.instant(),
): string | undefined {
  const hours = DEPLOY_WINDOWS.find((w) => w.id === window)?.hours ?? null;
  if (hours === null) return undefined;
  return now.subtract({ hours }).toString();
}

/** The status control: one list, four views of it. */
export const STATUS_VIEWS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live now" },
  { id: "progress", label: "In progress" },
  { id: "failed", label: "Failed" },
] as const;

export type StatusView = (typeof STATUS_VIEWS)[number]["id"];

export const zDeploymentsSearch = z.object({
  /** Status view; undefined renders as "all". */
  status: z.enum(["live", "progress", "failed"]).optional(),
  /** One resource's deployments; undefined = every resource. */
  resource: z.string().optional(),
  /** People a deploy is credited to (see `deployActor`). */
  people: z.array(z.string()).optional(),
  /** Deploys nobody triggered by hand (an API key, an automation). */
  automatic: z.boolean().optional(),
  /** Time window; undefined renders as the 7d default. */
  window: z.enum(["24h", "7d", "30d", "all"]).optional(),
  /** Free-text search over sha / commit message / author / resource / image. */
  q: z.string().optional(),
});

export type DeploymentsSearch = z.infer<typeof zDeploymentsSearch>;

/** One row of `deployment.listByProject`. Mirrors the contract's list item;
 *  plain strings rather than branded ids so fixtures and previews can build
 *  one. */
export interface ProjectDeployment {
  id: string;
  projectId: string;
  resourceId: string;
  resourceName: string;
  resourceKind: "database" | "service" | "compose";
  /** Display name of the environment the resource lives in. */
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
  gitCommitAuthorAvatar: string | null;
  /** Content hash of an uploaded source tarball: the upload analog of gitSha. */
  sourceSha: string | null;
  /** Who asked for it by hand; null for a push or an API key. */
  triggeredBy: { name: string; image: string | null } | null;
  isLatest: boolean;
  /** The deployment its resource is serving right now. */
  isServing: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Summary figures. Computed over every filter EXCEPT status. */
export interface ProjectDeploymentStats {
  windowTotal: number;
  failed: number;
  inFlight: number;
  serving: number;
  medianDurationMs: number | null;
}

/** What one resource is serving, whether or not it started inside the window. */
export interface ServingDeployment {
  resourceId: string;
  deploymentId: string;
  gitSha: string | null;
  sourceSha: string | null;
  image: string;
  completedAt: string | null;
  createdAt: string;
}

/**
 * Can this row be rolled back to? Mirrors `isRollbackable` in
 * `features/resources/components/_shared/rollback-dialog.tsx`: a settled
 * successful deploy with a real built image. Plus: only services roll back
 * (the mutation is `service.rollback`), and never to the deploy the resource
 * is already serving.
 */
export function isRollbackEligible(d: ProjectDeployment): boolean {
  return (
    d.resourceKind === "service" &&
    !d.isServing &&
    (d.status === "running" || d.status === "superseded") &&
    !!d.image &&
    !d.image.startsWith("pending:")
  );
}
