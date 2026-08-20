/**
 * Pure filter/stat semantics for the project-wide deployments list. Split
 * from ./list-by-project.ts (which owns the query + assembly) so the status
 * vocabulary, search matching, and strip aggregation stay unit-testable
 * without a db mock, and the query module stays inside the file-length cap.
 */

import type { DeploymentRow } from "../project/deployments";

export type ProjectDeploymentsStatusFilter =
  | "building"
  | "running"
  | "failed"
  | "cancelled"
  | "superseded"
  | "removed";

/** Stored statuses that mean "this row was (or still is) the live/in-flight
 *  one": the states a NEWER deploy invalidates into `superseded`. */
export const IN_FLIGHT_OR_LIVE: ReadonlySet<DeploymentRow["status"]> = new Set([
  "pending",
  "building",
  "running",
]);

/**
 * Status as the project-wide list shows it, before any docker refinement.
 * Non-latest rows that never settled (running/building/pending) were replaced
 * by a newer deploy → `superseded`; everything else keeps its stored status.
 */
export function effectiveListedStatus(
  stored: DeploymentRow["status"],
  isLatest: boolean,
): DeploymentRow["status"] {
  if (!isLatest && IN_FLIGHT_OR_LIVE.has(stored)) return "superseded";
  return stored;
}

/** Does a row match the effective-status filter? `building` covers stored
 *  `pending` too (both render as in-flight). Single source of truth for the
 *  filter semantics, used by the list and unit-tested directly. */
export function matchesStatusFilter(
  filter: ProjectDeploymentsStatusFilter,
  stored: DeploymentRow["status"],
  isLatest: boolean,
): boolean {
  const effective = effectiveListedStatus(stored, isLatest);
  if (filter === "building") return effective === "building" || effective === "pending";
  return effective === filter;
}

/** The provenance fields free-text search reads. */
export interface SearchableRow {
  resourceName: string;
  gitSha: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  image: string;
  sourceSha: string | null;
}

/** Free-text search over the provenance fields an operator would paste or
 *  remember: sha, commit message, author, resource name, image ref, source
 *  hash. Case-insensitive substring; blank query matches everything. */
export function matchesQuery(row: SearchableRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.resourceName,
    row.gitSha,
    row.gitCommitMessage,
    row.gitCommitAuthor,
    row.image,
    row.sourceSha,
  ].some((field) => field != null && field.toLowerCase().includes(needle));
}

export interface ProjectDeploymentStats {
  windowTotal: number;
  failed: number;
  inFlight: number;
  medianDurationMs: number | null;
}

interface TimedRow {
  createdAt: Date;
  completedAt: Date | null;
}

/** Median wall time of the completed rows, null when none completed. */
export function medianDurationMs(rows: ReadonlyArray<TimedRow>): number | null {
  const durations = rows
    .flatMap((r) => (r.completedAt ? [r.completedAt.getTime() - r.createdAt.getTime()] : []))
    .filter((ms) => ms >= 0)
    .toSorted((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  // `?? 0` only satisfies noUncheckedIndexedAccess: mid < length here.
  const median =
    durations.length % 2 === 1
      ? (durations[mid] ?? 0)
      : ((durations[mid - 1] ?? 0) + (durations[mid] ?? 0)) / 2;
  return Math.round(median);
}

/**
 * Stats basis = every filter EXCEPT status (the strip keeps describing the
 * window while the status select narrows the table; a strip that reads
 * "100% failed" whenever the Failed filter is on would be noise). `failed` /
 * `inFlight` count effective stored statuses; the page's docker refinement
 * is not applied here — counts over the whole window can't afford a docker
 * round-trip per resource, and stored-effective is honest at strip
 * granularity.
 */
export function computeStats(
  rows: ReadonlyArray<TimedRow & { status: DeploymentRow["status"]; isLatest: boolean }>,
): ProjectDeploymentStats {
  let failed = 0;
  let inFlight = 0;
  for (const row of rows) {
    const effective = effectiveListedStatus(row.status, row.isLatest);
    if (effective === "failed") failed += 1;
    else if (effective === "building" || effective === "pending") inFlight += 1;
  }
  return {
    windowTotal: rows.length,
    failed,
    inFlight,
    medianDurationMs: medianDurationMs(rows),
  };
}
