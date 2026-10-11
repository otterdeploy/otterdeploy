/**
 * Pure model for the project Deployments page: which rows a status view
 * shows, how rows group into days, what the Started column needs to say, who
 * a deploy is credited to, and how a failure is described. No React, so each
 * rule is unit-tested on its own (see ./deployments-view.test.ts).
 */

import {
  deployActor,
  deployStatusGroup,
  type DeployActor,
} from "@otterdeploy/shared/deploy-status";
import { Temporal } from "@otterdeploy/shared/temporal";

import { buildTimeline } from "@/features/resources/components/_shared/deployment-timeline-model";

import type {
  ProjectDeployment,
  ProjectDeploymentStats,
  ServingDeployment,
  StatusView,
} from "../data/deployments-search";

// ── Status views ───────────────────────────────────────────────────────────

/** Does a row belong in a status view? The same grouping the server counts
 *  with (`deployStatusGroup`), so a view's count and its rows agree. */
export function inStatusView(d: ProjectDeployment, view: StatusView): boolean {
  switch (view) {
    case "all":
      return true;
    case "live":
      return d.isServing;
    case "progress":
      return deployStatusGroup(d.status) === "in-progress";
    case "failed":
      return deployStatusGroup(d.status) === "failed";
  }
}

/** Each view's count, from the server's summary (computed over the whole
 *  scope, not just the rows this page holds). */
export function statusViewCounts(stats: ProjectDeploymentStats): Record<StatusView, number> {
  return {
    all: stats.windowTotal,
    live: stats.serving,
    progress: stats.inFlight,
    failed: stats.failed,
  };
}

// ── Days ───────────────────────────────────────────────────────────────────

function plainDateOf(iso: string, timeZone: string): Temporal.PlainDate {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).toPlainDate();
}

export interface DayGroup<T> {
  /** ISO calendar date in the viewer's zone, e.g. "2026-10-11". */
  key: string;
  /** "Today" / "Yesterday", or null for any older day (the date says it). */
  relative: "Today" | "Yesterday" | null;
  /** Noon of that day, for formatting the date label in the viewer's locale. */
  epochMs: number;
  items: T[];
}

/**
 * Consecutive runs of rows sharing a calendar day in the viewer's zone. Rows
 * arrive newest first; grouping keeps that order, so days come newest first.
 */
export function groupByDay<T extends { createdAt: string }>(
  rows: ReadonlyArray<T>,
  now: Temporal.Instant,
  timeZone: string,
): DayGroup<T>[] {
  const today = now.toZonedDateTimeISO(timeZone).toPlainDate();
  const yesterday = today.subtract({ days: 1 });
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const day = plainDateOf(row.createdAt, timeZone);
    const key = day.toString();
    const last = groups.at(-1);
    if (last?.key === key) {
      last.items.push(row);
      continue;
    }
    groups.push({
      key,
      relative: day.equals(today) ? "Today" : day.equals(yesterday) ? "Yesterday" : null,
      epochMs: day.toZonedDateTime({ timeZone, plainTime: "12:00" }).epochMilliseconds,
      items: [row],
    });
  }
  return groups;
}

/** Per-day totals over a full list, so a day header can count every deploy of
 *  that day even when "Show older" has only revealed some of them. */
export function dayTotals(
  rows: ReadonlyArray<Pick<ProjectDeployment, "createdAt" | "status">>,
  timeZone: string,
): Map<string, { total: number; failed: number }> {
  const totals = new Map<string, { total: number; failed: number }>();
  for (const row of rows) {
    const key = plainDateOf(row.createdAt, timeZone).toString();
    const t = totals.get(key) ?? { total: 0, failed: 0 };
    t.total += 1;
    if (deployStatusGroup(row.status) === "failed") t.failed += 1;
    totals.set(key, t);
  }
  return totals;
}

/**
 * How much a clock needs to say to be unambiguous. A bare "14:18" is only
 * honest for today: on a row from Saturday it reads as a time today. Within the
 * week the weekday is enough; older rows need the date.
 */
export type StartedFormat = "time" | "weekday-time" | "date-time";

export function startedFormat(iso: string, now: Temporal.Instant, timeZone: string): StartedFormat {
  const day = plainDateOf(iso, timeZone);
  const today = now.toZonedDateTimeISO(timeZone).toPlainDate();
  if (day.equals(today)) return "time";
  const daysAgo = day.until(today, { largestUnit: "days" }).days;
  return daysAgo > 0 && daysAgo < 7 ? "weekday-time" : "date-time";
}

// ── Who ────────────────────────────────────────────────────────────────────

function branchOf(ref: string | null): string | null {
  if (!ref) return null;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

const VERB: Record<ProjectDeployment["reason"], string> = {
  create: "deployed",
  redeploy: "redeployed",
  "env-change": "changed variables",
  "image-change": "changed the image",
  restart: "restarted",
  "git-push": "deployed",
  rollback: "rolled back",
};

/** The By column: who, and what they did ("Marcus pushed to main", "Ada
 *  rolled back"). Credit follows `deployActor`, never the commit's author
 *  over the person who clicked. */
export function byLine(d: ProjectDeployment): { actor: DeployActor; verb: string } {
  const actor = deployActor(d);
  const branch = branchOf(d.gitRef);
  if (actor.kind === "person" && actor.via === "pushed") {
    return { actor, verb: branch ? `pushed to ${branch}` : "pushed" };
  }
  if (d.reason === "git-push" && branch) return { actor, verb: `deployed ${branch}` };
  return { actor, verb: VERB[d.reason] };
}

// ── Progress and failure ───────────────────────────────────────────────────

/** "step n of 4" for a deploy in flight, read off the same phases the
 *  pipeline draws when the row is expanded, so the two never disagree. */
export function inFlightStep(d: Pick<ProjectDeployment, "status" | "createdAt">): {
  step: number;
  of: number;
} | null {
  if (deployStatusGroup(d.status) !== "in-progress") return null;
  const { phases } = buildTimeline({
    status: d.status,
    errorMessage: null,
    taskCount: 0,
    runningTaskCount: 0,
    completedAt: null,
    createdAt: d.createdAt,
  });
  const active = phases.findIndex((p) => p.state === "active");
  return { step: active < 0 ? 1 : active + 1, of: phases.length };
}

/**
 * Where a failed deploy stopped. A build replaces the row's `pending:` image
 * placeholder with the tag it built, so a placeholder still in place means the
 * build never finished; anything else failed while rolling out.
 */
export function failedDuring(d: Pick<ProjectDeployment, "image">): "build" | "deploy" {
  return d.image.startsWith("pending:") ? "build" : "deploy";
}

/** The short ref a person recognises a deploy by: commit, upload or image. */
function shortRef(d: Pick<ServingDeployment, "gitSha" | "sourceSha" | "image">): string {
  if (d.gitSha) return d.gitSha.slice(0, 7);
  if (d.sourceSha) return d.sourceSha.slice(0, 7);
  const tag = d.image.split("/").at(-1) ?? d.image;
  return tag;
}

/**
 * The plain sentence under a failed row: where it stopped, and what the
 * resource kept serving ("Failed during the build. web kept serving a8d3f19.").
 */
export function failureSentence(
  d: Pick<ProjectDeployment, "status" | "image" | "resourceName" | "isLatest">,
  serving: Pick<ServingDeployment, "gitSha" | "sourceSha" | "image"> | undefined,
): { lead: string; kept: { resource: string; ref: string } | null } {
  if (d.status === "crashed") {
    return { lead: "Came up, then kept crashing. The container is restarting.", kept: null };
  }
  const lead = failedDuring(d) === "build" ? "Failed during the build." : "Failed during rollout.";
  // Only the resource's newest deploy can say what it "kept serving": for an
  // older failure, what serves now is not what served then.
  const kept = d.isLatest && serving ? { resource: d.resourceName, ref: shortRef(serving) } : null;
  return { lead, kept };
}

/** The status as a word, beside its icon. */
export function statusWord(d: Pick<ProjectDeployment, "status" | "isServing" | "image">): string {
  switch (d.status) {
    case "running":
      return d.isServing ? "Live" : "Running";
    case "failed":
      return failedDuring(d) === "build" ? "Build failed" : "Deploy failed";
    case "pending":
      return "Queued";
    case "building":
      return "Building";
    case "starting":
      return "Deploying";
    case "crashed":
      return "Crashed";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
    case "superseded":
      return "Replaced";
    case "removed":
      return "Removed";
  }
}

// ── What changed ───────────────────────────────────────────────────────────

/** The Change column: a headline, and the refs under it. */
export interface ChangeSummary {
  title: string;
  /** The title is machine text (an image ref) and sets in mono. */
  titleMono: boolean;
  sha: string | null;
  branch: string | null;
  /** What kind of change this is, when the title alone doesn't say. */
  note: string | null;
}

function imageTag(image: string): string {
  return image.split("/").at(-1) ?? image;
}

export function changeOf(d: ProjectDeployment): ChangeSummary {
  const subject = d.gitCommitMessage?.split("\n", 1)[0]?.trim() || null;
  const branch = branchOf(d.gitRef);
  if (d.reason === "env-change") {
    return {
      title: "Variables changed",
      titleMono: false,
      sha: d.gitSha?.slice(0, 7) ?? null,
      branch,
      note: d.gitSha ? subject : imageTag(d.image),
    };
  }
  if (d.gitSha) {
    return {
      title: subject ?? `Commit ${d.gitSha.slice(0, 7)}`,
      titleMono: subject === null,
      sha: d.gitSha.slice(0, 7),
      branch,
      note: null,
    };
  }
  if (d.sourceSha) {
    return {
      title: "Uploaded source",
      titleMono: false,
      sha: d.sourceSha.slice(0, 7),
      branch: null,
      note: null,
    };
  }
  return {
    title: imageTag(d.image),
    titleMono: true,
    sha: null,
    branch: null,
    note: d.reason === "create" ? "first deploy" : d.reason === "restart" ? "restart" : "image",
  };
}
