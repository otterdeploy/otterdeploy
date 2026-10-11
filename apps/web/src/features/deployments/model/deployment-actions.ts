/**
 * Which row actions a deploy offers. Pure, so the menu and the expanded row's
 * buttons read one rule.
 */

import { deployStatusGroup } from "@otterdeploy/shared/deploy-status";

import type { ProjectDeployment } from "../data/deployments-search";

/**
 * "Redeploy" for the deploy a service is serving, "Retry" for its newest
 * deploy when that one failed; null otherwise. Only services redeploy from
 * here, and an uploaded-source deploy cannot be rebuilt without its upload.
 */
export function canRedeploy(d: ProjectDeployment): "Redeploy" | "Retry" | null {
  if (d.resourceKind !== "service" || (d.sourceSha && !d.gitSha)) return null;
  if (d.isServing && deployStatusGroup(d.status) !== "in-progress") return "Redeploy";
  if (d.isLatest && deployStatusGroup(d.status) === "failed") return "Retry";
  return null;
}

/** What "copy" copies: the commit SHA, else the upload hash, else the image. */
export function copyTarget(d: ProjectDeployment): string {
  return d.gitSha ?? d.sourceSha ?? d.image;
}

export function copyLabel(d: ProjectDeployment): string {
  return d.gitSha || d.sourceSha ? "Copy SHA" : "Copy image";
}
