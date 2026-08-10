/**
 * The org-wide "what is happening right now" poll.
 *
 * One query, shared: the header pill renders it, and the notification inbox
 * reads its `busy` flag to decide its own poll cadence. React Query dedupes on
 * the key, so both consumers ride a single request rather than two timers
 * disagreeing about whether anything is building.
 */

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

/** Enough rows to see the shape of a backlog; the counts are never truncated. */
const PAGE = 20;

/** Tight while work is in flight, lazy when the workspace is quiet. Deploy
 *  lifecycle transitions push an `activity` resync over the org event stream
 *  (use-org-events), and apply/cancel paths invalidate this query directly.
 *  The idle tick is only a dead-stream backstop. */
const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 180_000;

const activityInput = { input: { limit: PAGE } } as const;

export type DeployActivity = Awaited<ReturnType<typeof orpc.deployment.activity.call>>;
export type DeployActivityItem = DeployActivity["items"][number];

export function useDeployActivity() {
  const query = useQuery({
    ...orpc.deployment.activity.queryOptions(activityInput),
    refetchInterval: (q) => {
      const data = q.state.data;
      return data && data.building + data.queued > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    },
    // The header is visible on every page and this drives a live count; keeping
    // it polling while the window is unfocused means switching back shows the
    // truth immediately rather than a number from whenever you left.
    refetchIntervalInBackground: true,
  });

  const building = query.data?.building ?? 0;
  const queued = query.data?.queued ?? 0;

  return {
    items: query.data?.items ?? [],
    building,
    queued,
    total: building + queued,
    builderStalled: query.data?.builderStalled ?? false,
    /** Anything at all owed. Drives whether the pill renders and how fast the
     *  notification inbox polls. */
    busy: building + queued > 0,
    /**
     * The instant this snapshot was fetched. What row durations measure from.
     *
     * NOT `Date.now()` at render: reading the clock during render is impure, and
     * it would also make two renders of the same data disagree. This value is
     * stable per fetch and advances on every poll, which is exactly the
     * resolution a "queued 4m" label needs. (Same reasoning as `fetchedAt` in
     * features/deployments/hooks/use-deploy-status.ts.)
     */
    fetchedAt: query.dataUpdatedAt,
  };
}
