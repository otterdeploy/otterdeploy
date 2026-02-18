import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { CalendarIcon, LayoutGrid, LayoutList } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

type PresetRange = "1h" | "6h" | "1d" | "7d" | "30d";
type TimeRange = PresetRange | "custom";

const TIME_RANGES: { label: string; value: PresetRange }[] = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "1d", value: "1d" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

const RANGE_POINTS: Record<PresetRange, { count: number; stepMs: number }> = {
  "1h": { count: 30, stepMs: 2 * 60 * 1000 },
  "6h": { count: 36, stepMs: 10 * 60 * 1000 },
  "1d": { count: 48, stepMs: 30 * 60 * 1000 },
  "7d": { count: 42, stepMs: 4 * 60 * 60 * 1000 },
  "30d": { count: 30, stepMs: 24 * 60 * 60 * 1000 },
};

const chartConfig = {
  sum: {
    label: "Sum",
    color: "hsl(262, 83%, 58%)",
  },
  replicas: {
    label: "Replicas",
    color: "hsl(217, 91%, 60%)",
  },
} satisfies ChartConfig;

function generatePresetData(
  range: PresetRange,
  baseSum: number,
  baseReplicas: number,
  variance: number,
) {
  const { count, stepMs } = RANGE_POINTS[range];
  const now = Date.now();
  const start = now - count * stepMs;

  return Array.from({ length: count }, (_, i) => {
    const time = new Date(start + i * stepMs);
    const jitter = () => (Math.random() - 0.5) * 2 * variance;
    return {
      time: time.toISOString(),
      sum: Math.max(0, baseSum + jitter()),
      replicas: Math.max(0, baseReplicas + jitter()),
    };
  });
}

function generateCustomData(
  from: Date,
  to: Date,
  baseSum: number,
  baseReplicas: number,
  variance: number,
) {
  const diffMs = to.getTime() - from.getTime();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);

  let count: number;
  let stepMs: number;
  if (diffDays <= 1) {
    count = 24;
    stepMs = diffMs / count;
  } else if (diffDays <= 7) {
    count = Math.ceil(diffDays) * 6;
    stepMs = diffMs / count;
  } else {
    count = Math.min(Math.ceil(diffDays), 60);
    stepMs = diffMs / count;
  }

  return Array.from({ length: count + 1 }, (_, i) => {
    const time = new Date(from.getTime() + i * stepMs);
    const jitter = () => (Math.random() - 0.5) * 2 * variance;
    return {
      time: time.toISOString(),
      sum: Math.max(0, baseSum + jitter()),
      replicas: Math.max(0, baseReplicas + jitter()),
    };
  });
}

function usesDateLabels(range: TimeRange, customRange: DateRange | undefined) {
  if (range === "custom" && customRange?.from && customRange?.to) {
    const diffMs = customRange.to.getTime() - customRange.from.getTime();
    return diffMs > 24 * 60 * 60 * 1000;
  }
  return range === "7d" || range === "30d";
}

function formatTimeLabel(iso: string, dateLabels: boolean) {
  const d = new Date(iso);
  if (dateLabels) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function InlineLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: chartConfig.sum.color }}
        />
        Sum
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full border"
          style={{ borderColor: chartConfig.replicas.color }}
        />
        Replicas
      </span>
    </div>
  );
}

function MetricChart({
  title,
  data,
  yFormatter,
  dateLabels,
  className,
}: {
  title: string;
  data: { time: string; sum: number; replicas: number }[];
  yFormatter: (v: number) => string;
  dateLabels: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <InlineLegend />
      </CardHeader>
      <CardContent className="pt-0">
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`fill-sum-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartConfig.sum.color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={chartConfig.sum.color} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`fill-replicas-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartConfig.replicas.color} stopOpacity={0.1} />
                <stop offset="100%" stopColor={chartConfig.replicas.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="time"
              tickFormatter={(v) => formatTimeLabel(v, dateLabels)}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={yFormatter}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => formatTimeLabel(v as string, dateLabels)}
                  formatter={(value, name) => {
                    const label = name === "sum" ? "Sum" : "Replicas";
                    return `${label}: ${yFormatter(value as number)}`;
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="sum"
              stroke={chartConfig.sum.color}
              strokeWidth={2}
              fill={`url(#fill-sum-${title})`}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="replicas"
              stroke={chartConfig.replicas.color}
              strokeWidth={2}
              strokeDasharray="4 4"
              fill={`url(#fill-replicas-${title})`}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function MetricsPanel() {
  const [range, setRange] = useState<TimeRange>("1h");
  const [view, setView] = useState("grid");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const hasValidCustomRange =
    range === "custom" && customRange?.from != null && customRange?.to != null;

  const cpuData = useMemo(() => {
    if (hasValidCustomRange) {
      return generateCustomData(customRange.from!, customRange.to!, 0.25, 0.12, 0.08);
    }
    return generatePresetData(range as PresetRange, 0.25, 0.12, 0.08);
  }, [range, hasValidCustomRange, customRange?.from, customRange?.to]);

  const memoryData = useMemo(() => {
    if (hasValidCustomRange) {
      return generateCustomData(customRange.from!, customRange.to!, 256, 128, 40);
    }
    return generatePresetData(range as PresetRange, 256, 128, 40);
  }, [range, hasValidCustomRange, customRange?.from, customRange?.to]);

  const networkData = useMemo(() => {
    if (hasValidCustomRange) {
      return generateCustomData(customRange.from!, customRange.to!, 1200, 800, 300);
    }
    return generatePresetData(range as PresetRange, 1200, 800, 300);
  }, [range, hasValidCustomRange, customRange?.from, customRange?.to]);

  const dateLabels = usesDateLabels(range, customRange);

  const formatCpu = (v: number) => `${v.toFixed(2)} vCPU`;
  const formatMemory = (v: number) => `${Math.round(v)} MB`;
  const formatBytes = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)} KB/s`;
    return `${Math.round(v)} B/s`;
  };

  const customLabel = hasValidCustomRange
    ? `${formatDateLabel(customRange.from!)} - ${formatDateLabel(customRange.to!)}`
    : "Custom";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ToggleGroup
            value={range === "custom" ? [] : [range]}
            onValueChange={(values) => {
              if (values.length > 0) {
                setRange(values[0] as PresetRange);
              }
            }}
            variant="outline"
            size="sm"
          >
            {TIME_RANGES.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Popover
            open={calendarOpen}
            onOpenChange={(open) => {
              setCalendarOpen(open);
              if (!open && customRange?.from && customRange?.to) {
                setRange("custom");
              }
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  variant={range === "custom" ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                />
              }
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              <span className="text-xs">{customLabel}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                defaultMonth={customRange?.from}
                selected={customRange}
                onSelect={setCustomRange}
                disabled={{ after: new Date() }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>

        <ToggleGroup
          value={[view]}
          onValueChange={(values) => {
            if (values.length > 0) setView(values[0]);
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="list" aria-label="List view">
            <LayoutList className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div
        className={
          view === "grid"
            ? "grid grid-cols-1 gap-4 md:grid-cols-2"
            : "grid grid-cols-1 gap-4"
        }
      >
        <MetricChart
          title="CPU"
          data={cpuData}
          yFormatter={formatCpu}
          dateLabels={dateLabels}
        />
        <MetricChart
          title="Memory"
          data={memoryData}
          yFormatter={formatMemory}
          dateLabels={dateLabels}
        />
        <MetricChart
          title="Public Network Traffic"
          data={networkData}
          yFormatter={formatBytes}
          dateLabels={dateLabels}
          className={view === "grid" ? "md:col-span-2" : undefined}
        />
      </div>
    </div>
  );
}
