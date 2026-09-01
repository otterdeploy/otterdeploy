/**
 * Metrics tab: the host's own series over a chosen window. Short windows
 * poll in step with the health reports; long ones relax. The window and
 * the CPU view are local state: neither is worth a URL.
 */
import { useState } from "react";

import type { Server } from "@/features/servers/data/server";
import type { HostHealth } from "@/features/servers/detail/use-server-detail";

import {
  ErrorState,
  LiveIndicator,
  LoadingState,
} from "@/features/resources/components/_shared/metrics/metrics-tab-chrome";
import {
  SERVER_METRIC_WINDOWS,
  SERVER_SAMPLE_INTERVAL_MS,
  useServerMetrics,
  type ServerMetricWindowLabel,
} from "@/features/servers/detail/use-server-metrics";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";

import {
  CpuPanel,
  DiskIoPanel,
  LoadPanel,
  MemoryPanel,
  NetworkPanel,
  PerCoreGrid,
  type CpuMode,
} from "./server-detail-metric-panels";
import { SectionCard } from "./server-detail-parts";

const DEFAULT_WINDOW = SERVER_METRIC_WINDOWS[1];

function WindowPicker({
  value,
  onChange,
}: {
  value: ServerMetricWindowLabel;
  onChange: (next: ServerMetricWindowLabel) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => {
        const match = SERVER_METRIC_WINDOWS.find((w) => w.label === next[0]);
        if (match) onChange(match.label);
      }}
      variant="outline"
      size="sm"
      spacing={0}
    >
      {SERVER_METRIC_WINDOWS.map((w) => (
        <ToggleGroupItem
          key={w.label}
          value={w.label}
          aria-label={w.title}
          className="px-2.5 font-mono text-xs"
        >
          {w.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function ServerMetricsTab({ server, health }: { server: Server; health: HostHealth | null }) {
  const [window, setWindow] = useState<ServerMetricWindowLabel>(DEFAULT_WINDOW.label);
  const [cpuMode, setCpuMode] = useState<CpuMode>("total");
  const selected = SERVER_METRIC_WINDOWS.find((w) => w.label === window) ?? DEFAULT_WINDOW;
  const { rows, summary, isLoading, isError, updatedAt } = useServerMetrics(
    server.id,
    selected.minutes,
  );
  const hasData = rows.length > 0;
  const cores = health?.cpu?.coreCount ?? server.cpuTotal;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <WindowPicker value={window} onChange={setWindow} />
          <span className="text-[11.5px] text-muted-foreground">
            one point per health report · {selected.live ? "live" : "history"}
          </span>
        </div>
        {selected.live && hasData ? <LiveIndicator updatedAt={updatedAt} /> : null}
      </div>

      {hasData ? (
        <div className="flex flex-col gap-4">
          <CpuPanel
            rows={rows}
            summary={summary}
            sampleIntervalMs={SERVER_SAMPLE_INTERVAL_MS}
            mode={cpuMode}
            onMode={setCpuMode}
          />
          {health?.cpu && health.cpu.perCorePct.length > 1 && (
            <SectionCard title="Per core" hint="from the latest report; no history is kept per core">
              <PerCoreGrid perCore={health.cpu.perCorePct} />
            </SectionCard>
          )}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <LoadPanel rows={rows} sampleIntervalMs={SERVER_SAMPLE_INTERVAL_MS} cores={cores} />
            <MemoryPanel rows={rows} sampleIntervalMs={SERVER_SAMPLE_INTERVAL_MS} />
            <DiskIoPanel rows={rows} sampleIntervalMs={SERVER_SAMPLE_INTERVAL_MS} />
            <NetworkPanel rows={rows} sampleIntervalMs={SERVER_SAMPLE_INTERVAL_MS} />
          </div>
        </div>
      ) : isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState />
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 px-6 py-10 text-center">
          <div className="text-[13.5px] font-medium">No reports in this window</div>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">
            Each health report from {server.name} adds one point. Widen the window, or check the
            state banner if the box has stopped reporting.
          </p>
        </div>
      )}
    </>
  );
}
