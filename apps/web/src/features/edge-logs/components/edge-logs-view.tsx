import { useMemo, useState } from "react";

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { classifyThreat } from "../threat";
import { BUCKETS, BUCKET_TEXT, METHOD_TEXT, METHODS } from "./edge-logs-constants";
import { Chips, LiveBadge, RANGES, type Range, Segmented, toggleSet } from "./edge-logs-shared";
import { exportCsv, HostFooter, LogHistogram, LogTable } from "./edge-logs-view-parts";
import { HostFilter } from "./host-filter";

/**
 * Edge access logs view. Scoped to one project's domains when `projectId` is
 * given, otherwise all the org's domains. Full-bleed table (no card box),
 * matching the design — sectioned by border-b separators.
 */
export function EdgeLogsView({ projectId }: { projectId?: string }) {
  const [range, setRange] = useState<Range>("1h");
  const [methods, setMethods] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [hostFilter, setHostFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({
    ...orpc.edgeLogs.query.queryOptions({
      input: {
        projectId,
        range,
        methods: methods.size ? [...methods] : undefined,
        statuses: statuses.size ? ([...statuses] as ("2xx" | "3xx" | "4xx" | "5xx")[]) : undefined,
        hosts: hostFilter.length ? hostFilter : undefined,
        search: search.trim() || undefined,
      },
    }),
    refetchInterval: live ? 2000 : false,
  });

  // Ban an offending IP straight from a log row. CrowdSec-enforced (no Caddy
  // reload); reversible from the Firewall view.
  const block = useMutation({
    ...orpc.firewall.block.mutationOptions(),
    onSuccess: (r, vars) => {
      if (r.ok) toast.success(`Blocked ${vars.ip} — enforced at the edge`);
      else toast.error(r.error ?? "Block failed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Block failed"),
  });

  const data = query.data;
  const allRows = data?.rows ?? [];
  // Client-side narrow to scanner probes. Classification is a pure path check
  // (see threat.ts); it scopes the visible rows within the fetched window.
  const suspiciousCount = useMemo(
    () => allRows.filter((r) => classifyThreat(r.path)).length,
    [allRows],
  );
  const rows = suspiciousOnly ? allRows.filter((r) => classifyThreat(r.path)) : allRows;
  const hostOptions = useMemo(
    () => (data?.hostStats ?? []).map((s) => s.host).sort(),
    [data?.hostStats],
  );

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">Edge access logs</h1>
          <LiveBadge live={live} />
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Every HTTP request that hit the Caddy edge proxy. Live-tailed from Caddy's structured
          access log.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Segmented options={RANGES} value={range} onChange={(v) => setRange(v as Range)} />
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
          placeholder="search path, ip, status…"
          className="h-8 max-w-xs text-[12px]"
        />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className={cn(
            suspiciousOnly
              ? "border-destructive/40 bg-destructive/10 text-destructive hover:text-destructive"
              : suspiciousCount > 0 && "text-destructive",
          )}
          onClick={() => setSuspiciousOnly((v) => !v)}
          title="Show only scanner-style probe requests (.env, /actuator, *.php, ?cmd=…)"
        >
          Suspicious{suspiciousCount > 0 ? ` (${suspiciousCount})` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={cn(wrap && "bg-muted")}
          onClick={() => setWrap((v) => !v)}
          title="Wrap long values in expanded rows instead of truncating"
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

      <LogHistogram data={data} range={range} />

      <LogTable
        rows={rows}
        wrap={wrap}
        expanded={expanded}
        setExpanded={setExpanded}
        isLoading={query.isLoading}
        onBlockIp={(ip) => block.mutate({ ip })}
        blocking={block.isPending}
      />

      <HostFooter data={data} />
    </div>
  );
}
