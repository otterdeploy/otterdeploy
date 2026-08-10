/**
 * Rolls a project's live task states up into a single headline status and
 * reports it to the app-wide rollup, so the browser tab can show what the
 * project is doing while the operator is looking at another tab.
 *
 * Reads `serviceTasksCollection`. The same live data the project graph draws
 * its node badges from, so the tab and the graph can never disagree. No new
 * endpoint and no extra polling: the collection is already mounted and on a 5s
 * refetch, refreshed immediately by the project event stream.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useMemo } from "react";

import { eq, useLiveQuery } from "@tanstack/react-db";

import type { MarkStatus } from "@/shared/components/brand/mark-geometry";

import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { useReportAppStatus } from "@/shared/lib/app-status";

/**
 * Task states, mapped to what the tab says.
 *
 * `paused` is deliberately absent: a paused service is a deliberate operator
 * choice, not a condition needing attention, and flagging it would leave the
 * tab permanently warned on any project with something parked.
 */
function toMarkStatus(state: string): MarkStatus | null {
  if (state === "error") return "error";
  if (state === "building" || state === "queued") return "deploying";
  return null;
}

/** Most-concerning wins, matching `rollupStatus` in build-live-nodes.ts. */
function rollup(states: readonly string[]): MarkStatus {
  let deploying = false;
  for (const state of states) {
    const mapped = toMarkStatus(state);
    if (mapped === "error") return "error";
    if (mapped === "deploying") deploying = true;
  }
  return deploying ? "deploying" : "idle";
}

export function useProjectStatus(projectId: ProjectId | null | undefined): MarkStatus {
  const { data: rows } = useLiveQuery(
    (q) => q.from({ t: serviceTasksCollection }).where(({ t }) => eq(t.projectId, projectId ?? "")),
    [projectId],
  );

  const status = useMemo(
    () => (projectId ? rollup(rows.flatMap((row) => row.tasks.map((t) => t.state))) : "idle"),
    [projectId, rows],
  );

  // Keyed by project so navigating between projects swaps the contribution
  // instead of accumulating one stuck entry per project visited.
  useReportAppStatus(`project:${projectId ?? "none"}`, status);

  return status;
}
