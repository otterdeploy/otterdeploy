import { useState } from "react";

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { useEdgeBans } from "../data/use-edge-bans";
import { BlockAllButton } from "./edge-logs-block-ip";
import {
  BUCKETS,
  BUCKET_TEXT,
  type Bucket,
  type EdgeLogsData,
  METHOD_TEXT,
  METHODS,
} from "./edge-logs-constants";
import { Chips, LiveBadge, toggleSet, useStickyHostOptions } from "./edge-logs-shared";

// `Chips` traffics in plain strings, but only ever hands back one of the
// options it was given; this guard recovers the literal type.
const isBucket = (v: string): v is Bucket => BUCKETS.some((b) => b === v);
import { exportCsv, HostFooter, LogTable } from "./edge-logs-view-parts";
import { HostFilter } from "./host-filter";
import { LogHistogram } from "./log-histogram";
import {
  isPresetWindow,
  TimeRangePicker,
  type TimeWindow,
  windowLabels,
  windowQueryInput,
} from "./time-range-picker";

/**
 * Edge access logs view. Scoped to one project's domains when `projectId` is
 * given, otherwise all the org's domains. Full-bleed table (no card box),
 * matching the design, sectioned by border-b separators.
 */
export function EdgeLogsView({ projectId }: { projectId?: string }) {
  const { t } = useTranslation();
  const [timeWindow, setWindow] = useState<TimeWindow>({ preset: "1h" });
  const [methods, setMethods] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [hostFilter, setHostFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // A custom window is a fixed slice of the past: there is nothing to tail.
  const isLiveWindow = isPresetWindow(timeWindow);
  const query = useQuery({
    ...orpc.edgeLogs.query.queryOptions({
      input: {
        projectId,
        ...windowQueryInput(timeWindow),
        methods: methods.size ? [...methods] : undefined,
        statuses: statuses.size ? [...statuses].filter(isBucket) : undefined,
        hosts: hostFilter.length ? hostFilter : undefined,
        search: search.trim() || undefined,
        suspicious: suspiciousOnly || undefined,
      },
    }),
    refetchInterval: live && isLiveWindow ? 2000 : false,
    // Filter changes change the query key; without this the table and host
    // dropdown blank out (and flash back) on every checkbox click.
    placeholderData: keepPreviousData,
  });

  // Active CrowdSec bans + block actions (single from a row, bulk from the
  // suspicious filter). CrowdSec-enforced; reversible from the Firewall view.
  const { bannedIps, blockIp, blockAll, canBlock } = useEdgeBans();

  const data = query.data;
  // Already narrowed server-side when the filter is on: the row list IS the
  // suspicious list, so nothing is re-filtered here.
  const rows = data?.rows ?? [];
  const probes = probeFacts(data, bannedIps);
  const hostOptions = useStickyHostOptions(hostStatHosts(data));

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">{t("edgeLogs.accessLogs")}</h1>
          <LiveBadge live={live && isLiveWindow} />
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Every HTTP request that hit the Caddy edge proxy. Live-tailed from Caddy's structured
          access log.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <TimeRangePicker value={timeWindow} onChange={setWindow} />
        <Chips
          options={METHODS}
          selected={methods}
          colors={METHOD_TEXT}
          onToggle={(v) => setMethods((s) => toggleSet(s, v))}
        />
        <Chips
          options={BUCKETS}
          selected={statuses}
          colors={BUCKET_TEXT}
          onToggle={(v) => setStatuses((s) => toggleSet(s, v))}
        />
        <HostFilter options={hostOptions} value={hostFilter} onChange={setHostFilter} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("edgeLogs.searchLogs")}
          className="h-8 max-w-xs text-[12px]"
        />
        <div className="flex-1" />
        <SuspiciousControls
          active={suspiciousOnly}
          count={probes.count}
          ips={probes.ips}
          onToggle={() => setSuspiciousOnly((v) => !v)}
          // Blocking is install-scoped; without the action the filter toggle
          // still works, so the control stays and only the button goes.
          onBlockAll={canBlock ? () => blockAll(probes.ips) : undefined}
        />
        <Button
          variant="outline"
          size="sm"
          className={cn(wrap && "bg-muted")}
          onClick={() => setWrap((v) => !v)}
          title={t("edgeLogs.wrapHint")}
        >
          Wrap
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLive((v) => !v)}>
          {live ? "Pause" : "Resume"}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(rows)}>
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          Export
        </Button>
      </div>

      <LogHistogram data={data} labels={windowLabels(timeWindow)} />

      <LogTable
        rows={rows}
        wrap={wrap}
        expanded={expanded}
        setExpanded={setExpanded}
        isLoading={query.isLoading}
        onBlockIp={canBlock ? blockIp : undefined}
        bannedIps={bannedIps}
      />

      <HostFooter data={data} />
    </div>
  );
}

/**
 * The probe count + offender set the toolbar acts on, straight from the
 * server, which computes both over the WHOLE window.
 *
 * Deriving them here from `data.rows` counted one capped page instead: rows
 * are the newest `limit` (200) of the window, so widening 1h → 7d left the
 * page unchanged while time pushed a probe burst off the end of it, and the
 * count FELL from 71 to 8. A window that contains another can never hold
 * fewer probes; only the server sees enough to say so.
 */
function probeFacts(
  data: EdgeLogsData | undefined,
  bannedIps: ReadonlySet<string>,
): { count: number; ips: string[] } {
  return {
    count: data?.suspiciousTotal ?? 0,
    // The mass-block target set; the server caps it at the blockMany limit.
    ips: (data?.suspiciousIps ?? []).filter((ip) => !bannedIps.has(ip)),
  };
}

/** The hosts the current window saw traffic for, per the query's hostStats. */
function hostStatHosts(data: { hostStats: { host: string }[] } | undefined): string[] {
  return (data?.hostStats ?? []).map((s) => s.host);
}

/** Suspicious-only toggle + the bulk "Block N IPs" action that appears while
 *  the filter is active and unbanned offender IPs remain. */
function SuspiciousControls({
  active,
  count,
  ips,
  onToggle,
  onBlockAll,
}: {
  active: boolean;
  count: number;
  ips: string[];
  onToggle: () => void;
  /** Absent when the viewer can't block. The toggle stays, the action goes. */
  onBlockAll?: () => void;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          active
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:text-destructive"
            : count > 0 && "text-destructive",
        )}
        onClick={onToggle}
        title="Show only scanner-style probe requests (.env, /actuator, *.php, ?cmd=…)"
      >
        Suspicious{count > 0 ? ` (${count})` : ""}
      </Button>
      {active && ips.length > 0 && onBlockAll ? (
        <BlockAllButton count={ips.length} onConfirm={onBlockAll} />
      ) : null}
    </>
  );
}
