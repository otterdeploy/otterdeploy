/**
 * Publishes the BUILD PIPELINE's state to the app-status rollup, so the browser
 * tab (favicon) and the header bell can see a deploy that is still building.
 *
 * Why this exists separately from `useProjectStatus`: that hook reads
 * `serviceTasksCollection`, which is live *swarm/container* state. Its
 * "building" bucket means a container is being scheduled or started
 * (new/pending/preparing/starting — see resource-instances.ts), which only
 * happens AFTER an image exists. During the slow part — railpack/buildx
 * actually building, which is minutes — the deployment has no swarm task at
 * all, so the task rollup reports `idle` and the tab sat blank through the
 * entire build. That is the gap this closes.
 *
 * It reports the failure edge too, and must: `useFaviconStatus` turns
 * "was deploying → now idle" into a green success tick. If this hook reported
 * only the in-flight half, a FAILED build would roll up to idle and earn that
 * tick — the tab would claim success for a build that just died.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import type { MarkStatus } from "@/shared/components/brand/mark-geometry";

import { useReportAppStatus } from "@/shared/lib/app-status";
import { orpc } from "@/shared/server/orpc";

/**
 * Statuses that mean "work is happening right now". `starting` is included —
 * from the operator's side the deploy isn't done until the container is up, and
 * the swarm-task rollup covers the same window, so the two agree rather than
 * fighting over the tab.
 */
const IN_FLIGHT: ReadonlySet<string> = new Set(["pending", "building", "starting"]);

/**
 * How long a failure keeps the tab red. A failed deployment row stays failed
 * forever, so reporting it unconditionally would pin the favicon red until the
 * next successful deploy — the tab would stop meaning "something needs you now"
 * and become permanent decoration. Long enough to be noticed on return from
 * another tab, short enough to settle.
 */
const FAILURE_WINDOW_MS = 5 * 60_000;

/**
 * Past this age an in-flight row is treated as stranded, not building.
 *
 * Mirrors `HELPER_TIMEOUT_MS` in apps/builder/src/handler.ts: the builder kills
 * its helper container at that wall, so no legitimate build can still be alive
 * beyond it. A row left in `pending`/`building` past that point is one whose
 * helper died without repairing it — which really happens (a helper that can't
 * start at all never reaches `markBuilding`, so nothing converges the row).
 *
 * Without this ceiling a single stranded row spins the tab forever, and the
 * favicon stops meaning "work is happening" — the exact failure mode where an
 * always-on indicator becomes furniture you learn to ignore.
 */
const STRANDED_AFTER_MS = 45 * 60_000;

/** Enough to see the current wave of activity without pulling real history. */
const PAGE = 10;

/** Tight while something is in flight; back off hard when the project is
 *  quiet — the event stream carries transitions, so idle polling is only a
 *  dead-stream backstop. */
const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 60_000;

interface DeployRow {
  status: string;
  createdAt: string;
  completedAt: string | null;
}

/**
 * `deploying` if anything is in flight, else `error` for a failure inside
 * {@link FAILURE_WINDOW_MS}, else idle. In-flight outranks a recent failure: a
 * retry already running is the more useful headline.
 */
export function rollupDeployStatus(rows: readonly DeployRow[], now: number): MarkStatus {
  let recentFailure = false;
  for (const row of rows) {
    if (IN_FLIGHT.has(row.status)) {
      // An unparseable timestamp fails OPEN here (counts as in flight): the row
      // says it is building, and silently ignoring that would hide a real deploy.
      // The failure branch below fails closed, for the opposite reason.
      const startedAt = Date.parse(row.createdAt);
      if (!Number.isFinite(startedAt) || now - startedAt <= STRANDED_AFTER_MS) return "deploying";
      continue;
    }
    if (row.status !== "failed") continue;
    // `completedAt` is when it actually failed; `createdAt` is the fallback for
    // a row that never recorded a completion.
    const at = Date.parse(row.completedAt ?? row.createdAt);
    if (Number.isFinite(at) && now - at <= FAILURE_WINDOW_MS) recentFailure = true;
  }
  return recentFailure ? "error" : "idle";
}

export function useProjectDeployStatus(projectId: ProjectId | null | undefined): MarkStatus {
  const query = useQuery({
    ...orpc.deployment.listByProject.queryOptions({
      input: { projectId: projectId ?? ("" as ProjectId), limit: PAGE },
    }),
    enabled: Boolean(projectId),
    // Deliberately its own cache entry, not the deployments page's — that query
    // carries the user's filters and window, which would silently scope what the
    // tab is allowed to notice.
    queryKey: [...orpc.deployment.listByProject.key(), projectId ?? "none", "app-status", PAGE],
    // Fast only while a deploy is in flight. Idle is a slow backstop: real
    // transitions arrive over the project event stream (which also runs in
    // hidden tabs), so this poll exists to survive a silently dead stream,
    // not to deliver freshness.
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some((row) => IN_FLIGHT.has(row.status))
        ? POLL_ACTIVE_MS
        : POLL_IDLE_MS,
    // react-query pauses interval refetch for unfocused windows by default,
    // which is backwards for this one: the favicon exists to be read while you
    // are looking at a DIFFERENT tab. Without this the arc would start spinning
    // and then keep spinning — the repaint loop is local, so it never stops —
    // while the status that should end it never arrives until you refocus. The
    // tab would claim "still building" for a deploy that finished minutes ago.
    refetchIntervalInBackground: true,
  });

  const items = query.data?.items;
  // `dataUpdatedAt`, not `Date.now()`: "now" has to be the instant this snapshot
  // was fetched, not the instant React happened to re-render. Reading the clock
  // during render is impure — the memo would only recompute when `items` changed
  // while its result silently depended on wall time — and it would also make the
  // ageing-out below inconsistent between two renders of the same data. This
  // value is stable per fetch and advances on every poll, which is exactly the
  // resolution a favicon needs.
  const fetchedAt = query.dataUpdatedAt;
  const status = useMemo<MarkStatus>(
    () => (projectId && items ? rollupDeployStatus(items, fetchedAt) : "idle"),
    [projectId, items, fetchedAt],
  );

  // Keyed separately from `project:<id>` so both the pipeline and the swarm view
  // contribute and the rollup picks the most concerning, instead of one
  // overwriting the other.
  useReportAppStatus(`deploy:${projectId ?? "none"}`, status);

  return status;
}
