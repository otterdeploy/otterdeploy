/**
 * Pure filter/stat semantics for the project-wide deployments list. Split
 * from ./list-by-project.ts (which owns the query + assembly) so the status
 * vocabulary, search matching, and strip aggregation stay unit-testable
 * without a db mock, and the query module stays inside the file-length cap.
 */

import type { DeploymentId, ResourceId } from "@otterdeploy/shared/id";

import {
  deployActor,
  type DeployActorInput,
  deployStatusGroup,
} from "@otterdeploy/shared/deploy-status";

import type { DeploymentRow } from "../project/deployments";
import type { DerivedDeploymentStatus } from "../project/deployments-derive";

export type ProjectDeploymentsStatusFilter =
  | "building"
  | "running"
  | "failed"
  | "cancelled"
  | "superseded"
  | "removed"
  | "serving";

/** Stored statuses that mean "this row was (or still is) the live/in-flight
 *  one": the states a NEWER deploy invalidates into `superseded`. */
export const IN_FLIGHT_OR_LIVE: ReadonlySet<DeploymentRow["status"]> = new Set([
  "pending",
  "building",
  "running",
]);

/** Derived statuses of a deployment that reached its runtime: its containers
 *  came up (and may since have crashed, or been paused on purpose). */
const REACHED_RUNTIME: ReadonlySet<DerivedDeploymentStatus> = new Set([
  "running",
  "crashed",
  "paused",
]);

/** A resource's newest row, with its live-derived status when one was read. */
export interface LatestRow {
  id: DeploymentId;
  resourceId: ResourceId;
  stored: DeploymentRow["status"];
  /** Undefined when nothing was derived (docker unreachable, compose stack,
   *  a settled row): the stored status stands. */
  derived: DerivedDeploymentStatus | undefined;
}

/**
 * Which deployment each resource is serving right now.
 *
 * Not "the newest row": while a deploy rolls out, the previous one is still
 * what answers requests, and calling the new one current before it has come up
 * is the bug this replaces. The newest row serves once it has reached its
 * runtime (running, crash-looping, or deliberately paused). Until then the
 * resource is serving its newest stored-running deployment, which a newer
 * failed or cancelled build never displaced.
 */
export function resolveServing(
  latest: ReadonlyArray<LatestRow>,
  newestRunning: ReadonlyMap<ResourceId, DeploymentId>,
): Map<ResourceId, DeploymentId> {
  const serving = new Map(newestRunning);
  for (const row of latest) {
    const status = row.derived ?? row.stored;
    const pipelineGaveUp = row.stored === "failed" || row.stored === "cancelled";
    if (REACHED_RUNTIME.has(status) && !pipelineGaveUp) serving.set(row.resourceId, row.id);
  }
  return serving;
}

/**
 * Status as the project-wide list shows it. The ONE derivation the rows, the
 * filters and the summary counts all read, so they cannot disagree.
 *
 * - The newest row shows its live-derived status when one was read.
 * - The row a resource is serving keeps its stored status (running), even when
 *   a newer deploy is still in flight above it.
 * - Older rows that never settled were replaced: `superseded`.
 * - Everything else keeps its stored outcome (a failed build stays failed).
 */
export function listedStatus(
  row: { status: DeploymentRow["status"]; isLatest: boolean; isServing: boolean },
  derived?: DerivedDeploymentStatus,
): DerivedDeploymentStatus {
  if (row.isLatest && derived) return derived;
  if (row.isServing) return row.status;
  if (!row.isLatest && IN_FLIGHT_OR_LIVE.has(row.status)) return "superseded";
  return row.status;
}

/** Does a listed row match the status filter? `building` is everything still
 *  in progress, `failed` everything that broke (see `deployStatusGroup`),
 *  `serving` the deploy each resource is serving; the rest match exactly. */
export function matchesStatusFilter(
  filter: ProjectDeploymentsStatusFilter,
  row: { status: DerivedDeploymentStatus; isServing: boolean },
): boolean {
  if (filter === "serving") return row.isServing;
  if (filter === "building") return deployStatusGroup(row.status) === "in-progress";
  if (filter === "failed") return deployStatusGroup(row.status) === "failed";
  return row.status === filter;
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
  /** Rows in scope that are the deployment their resource is serving. */
  serving: number;
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
 * Stats basis = every filter EXCEPT status (the summary keeps describing the
 * window while the status control narrows the list; a summary that reads
 * "100% failed" whenever the Failed filter is on would be noise). Counts read
 * the same listed status the rows show, refinement included, through the same
 * grouping the status filter uses.
 */
export function computeStats(
  rows: ReadonlyArray<TimedRow & { status: DerivedDeploymentStatus; isServing: boolean }>,
): ProjectDeploymentStats {
  let failed = 0;
  let inFlight = 0;
  let serving = 0;
  for (const row of rows) {
    const group = deployStatusGroup(row.status);
    if (group === "failed") failed += 1;
    else if (group === "in-progress") inFlight += 1;
    if (row.isServing) serving += 1;
  }
  return {
    windowTotal: rows.length,
    failed,
    inFlight,
    serving,
    medianDurationMs: medianDurationMs(rows),
  };
}

/** The person filter: names of people (as `deployActor` credits them), plus
 *  whether deploys with nobody behind them are wanted. Empty = no filter. */
export interface PeopleFilter {
  names: ReadonlyArray<string>;
  automatic: boolean;
}

export function matchesPeople(row: DeployActorInput, filter: PeopleFilter): boolean {
  if (filter.names.length === 0 && !filter.automatic) return true;
  const actor = deployActor(row);
  if (actor.kind === "automatic") return filter.automatic;
  return filter.names.includes(actor.name);
}

export interface PeopleFacets {
  people: { name: string; image: string | null; count: number }[];
  automatic: number;
}

/** Who the deploys in scope are credited to, most active first: the options
 *  the person filter offers. */
export function peopleFacets(rows: ReadonlyArray<DeployActorInput>): PeopleFacets {
  const byName = new Map<string, { name: string; image: string | null; count: number }>();
  let automatic = 0;
  for (const row of rows) {
    const actor = deployActor(row);
    if (actor.kind === "automatic") {
      automatic += 1;
      continue;
    }
    const seen = byName.get(actor.name);
    if (seen) {
      seen.count += 1;
      seen.image ??= actor.image;
    } else byName.set(actor.name, { name: actor.name, image: actor.image, count: 1 });
  }
  const people = [...byName.values()].toSorted(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  return { people, automatic };
}
