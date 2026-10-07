/**
 * The metrics tab's chrome: the time-range field, the live indicator, and
 * the loading / empty / error states. Everything that is not a chart.
 */

import { Activity03Icon, Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { formatDuration, useNowTick } from "@/shared/lib/duration";

import { formatClockSeconds } from "./format";
import { METRIC_WINDOWS, type MetricWindowLabel } from "./use-resource-metrics";

/** Value → label map the select needs to render the chosen range in its
 *  trigger. The live ranges say so in the label, like the caption promises. */
const WINDOW_ITEMS = METRIC_WINDOWS.map((w) => ({
  value: w.label,
  label: w.live ? `${w.title} · live` : w.title,
}));

export function TimeRangeField({
  value,
  onChange,
}: {
  value: MetricWindowLabel;
  onChange: (next: MetricWindowLabel) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="metrics-time-range">Time range</Label>
      <Select
        items={WINDOW_ITEMS}
        value={value}
        onValueChange={(next) => {
          // Only values rendered below can come back; find() recovers the
          // narrowed label type without asserting.
          const match = METRIC_WINDOWS.find((w) => w.label === next);
          if (match) onChange(match.label);
        }}
      >
        <SelectTrigger id="metrics-time-range" className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WINDOW_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * How fresh the charts are, in words. The live ranges say so and count up
 * from their last refresh; the long ones (refreshed every few minutes) only
 * count. Replaces a paragraph that explained the refresh cadence: the age of
 * what is on screen is the thing worth reading, not the schedule behind it.
 */
export function LiveIndicator({ live, updatedAt }: { live: boolean; updatedAt: number }) {
  // The hook's default one-second tick: the caption reads in seconds.
  const now = useNowTick(true);
  return (
    <div className="flex items-center gap-2">
      {live ? (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-4xl bg-muted px-2.5 text-xs font-medium">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          Live updates
        </span>
      ) : null}
      <span
        className="text-[11px] text-muted-foreground tabular-nums"
        title={updatedAt ? formatClockSeconds(updatedAt) : undefined}
      >
        {updatedAgo(updatedAt, now)}
      </span>
    </div>
  );
}

/** "updated 12s ago", or nothing worth saying before the first answer. */
export function updatedAgo(updatedAt: number, now: number): string {
  if (!updatedAt) return "";
  return `updated ${formatDuration(now - updatedAt)} ago`;
}

export function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[17.5rem] w-full rounded-lg" />
      ))}
    </div>
  );
}

export function EmptyMetricsState() {
  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Activity03Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>No samples yet</EmptyTitle>
        <EmptyDescription>
          Metrics are sampled from the running containers every 30 seconds. Once this resource has
          been live for a tick or two, CPU, memory, and network will chart here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ErrorState() {
  return (
    <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/50"
        />
        <EmptyTitle>Couldn’t load metrics</EmptyTitle>
        <EmptyDescription>
          The metrics query failed. It will retry automatically on the next refresh.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
