/**
 * Metrics tab: live CPU / memory / network for one resource's containers,
 * fed by `metrics.query` (30s Docker-stats samples). A time-range select
 * drives the look-back; the short ranges are live and poll in step with the
 * sampler, so the panel trails real time by at most one tick. Shared by the
 * database and service detail panels.
 *
 * Three full-width panels, one per metric, each a smooth area over a dashed
 * grid (`metric-panels.tsx`). This file owns the state machine: which
 * window is selected and which of loading / error / empty / charts to show.
 */

import { useState } from "react";

import { CpuPanel, MemoryPanel, NetworkPanel } from "./metric-panels";
import {
  EmptyMetricsState,
  ErrorState,
  LiveIndicator,
  LoadingState,
  TimeRangeField,
} from "./metrics-tab-chrome";
import { METRIC_WINDOWS, useResourceMetrics, type MetricWindowLabel } from "./use-resource-metrics";

const DEFAULT_WINDOW = METRIC_WINDOWS[1];

interface MetricsTabProps {
  resourceId: string;
}

export function MetricsTab({ resourceId }: MetricsTabProps) {
  const [window, setWindow] = useState<MetricWindowLabel>(DEFAULT_WINDOW.label);
  const selected = METRIC_WINDOWS.find((w) => w.label === window) ?? DEFAULT_WINDOW;

  const { rows, summary, isLoading, isError, updatedAt } = useResourceMetrics(
    resourceId,
    selected.minutes,
  );
  const hasData = rows.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Metrics</h2>
          <p className="text-xs text-muted-foreground">
            CPU, memory and network for this resource’s containers, sampled every 30 seconds.
          </p>
        </div>
        {selected.live && hasData ? <LiveIndicator updatedAt={updatedAt} /> : null}
      </div>

      <TimeRangeField value={window} onChange={setWindow} />

      {hasData ? (
        <div className="flex flex-col gap-4">
          <CpuPanel rows={rows} summary={summary} />
          <MemoryPanel rows={rows} summary={summary} />
          <NetworkPanel rows={rows} summary={summary} />
        </div>
      ) : isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState />
      ) : (
        <EmptyMetricsState />
      )}
    </div>
  );
}
