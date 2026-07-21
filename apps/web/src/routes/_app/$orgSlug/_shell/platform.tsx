// Install-wide platform health: job-queue backlog + deploy throughput.
// Backed by metrics.platform (BullMQ snapshot/series + a deployment-table
// rollup). API latency/error-rate are intentionally absent — they live in
// evlog wide events with no queryable aggregation store yet.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/shared/components/page";
import { Card } from "@/shared/components/ui/card";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/_shell/platform")({
  staticData: { crumb: "Platform" },
  component: PlatformRoute,
  // Warm the platform-metrics query on hover (intent-preload) so the page
  // renders from cache instead of spinning. Non-blocking + best-effort.
  loader: () => {
    void queryClient
      .prefetchQuery(orpc.metrics.platform.queryOptions({ input: { windowMinutes: 60 } }))
      .catch(() => undefined);
  },
});

interface PlatformData {
  queueSnapshot: Array<{
    queue: string;
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
    completed: number;
  }>;
  waitingSeries: Array<{ ts: Date; value: number }>;
  activeSeries: Array<{ ts: Date; value: number }>;
  deploy: {
    succeeded: number;
    failed: number;
    inProgress: number;
    total: number;
    failureRate: number;
  };
}

function PlatformRoute() {
  const q = useQuery({
    ...orpc.metrics.platform.queryOptions({ input: { windowMinutes: 60 } }),
    refetchInterval: 15_000,
  });

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 pb-4 pt-6">
        <PageHeader
          title="Platform"
          description="Install-wide health — job-queue backlog and deploy throughput across the workspace (last hour)."
          actions={
            <span className="text-xs text-muted-foreground">
              {q.isFetching ? "refreshing…" : null}
            </span>
          }
        />
      </div>
      <div className="flex-1 overflow-auto p-6">
        {q.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : q.isError ? (
          <ErrorState
            message="Couldn't load platform metrics."
            onRetry={() => void q.refetch()}
          />
        ) : q.data ? (
          <PlatformBody data={q.data as PlatformData} />
        ) : null}
      </div>
    </div>
  );
}

const peak = (s: Array<{ value: number }>) =>
  s.reduce((m, p) => Math.max(m, p.value), 0);

function PlatformBody({ data }: { data: PlatformData }) {
  const { deploy, queueSnapshot, waitingSeries, activeSeries } = data;

  return (
    <div className="flex flex-col gap-6">
      {/* Deploy throughput */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Deploys (last hour)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Succeeded" value={deploy.succeeded} />
          <Stat label="Failed" value={deploy.failed} tone="danger" />
          <Stat label="In progress" value={deploy.inProgress} />
          <Stat
            label="Failure rate"
            value={`${Math.round(deploy.failureRate * 100)}%`}
            tone={deploy.failureRate > 0.25 ? "danger" : undefined}
          />
        </div>
      </section>

      {/* Queue backlog */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Job queues</h2>
          <span className="text-xs text-muted-foreground">
            peak waiting {peak(waitingSeries)} · peak active {peak(activeSeries)}
          </span>
        </div>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Queue</th>
                <th className="px-3 py-2 text-right font-medium">Waiting</th>
                <th className="px-3 py-2 text-right font-medium">Active</th>
                <th className="px-3 py-2 text-right font-medium">Failed</th>
                <th className="px-3 py-2 text-right font-medium">Delayed</th>
                <th className="px-3 py-2 text-right font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {queueSnapshot.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No queues registered.
                  </td>
                </tr>
              ) : (
                queueSnapshot.map((qd) => (
                  <tr key={qd.queue} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-[12.5px]">
                      {qd.queue}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qd.waiting}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qd.active}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        qd.failed > 0 ? "text-destructive" : ""
                      }`}
                    >
                      {qd.failed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qd.delayed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {qd.completed}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "danger";
}) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-2xl font-semibold tabular-nums ${
          tone === "danger" ? "text-destructive" : ""
        }`}
      >
        {value}
      </span>
    </Card>
  );
}
