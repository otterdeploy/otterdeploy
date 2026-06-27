/**
 * Firewall view — CrowdSec IP-reputation decisions, rendered as a tab inside
 * the Edge Logs page (an edge-level concern: cluster-wide / identity-blind, so
 * it sits beside Access + Events at the org scope). Follows the same full-height
 * instrument layout as those views: header + status pill, a hairline toolbar,
 * then a full-bleed table that fills the remaining height.
 */
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { BlocklistsPanel } from "./blocklists-panel";
import { FirewallDisabledCard } from "./firewall-view-parts";

type View = "decisions" | "sources";

export function FirewallView() {
  const status = useQuery({
    ...orpc.firewall.status.queryOptions(),
    refetchInterval: 15_000,
  });
  const decisions = useQuery({
    ...orpc.firewall.decisions.queryOptions(),
    refetchInterval: 15_000,
  });

  const s = status.data;
  const rows = decisions.data ?? [];
  const reachable = Boolean(s?.reachable);
  const configured = Boolean(s?.configured);
  const [view, setView] = useState<View>("decisions");

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <FirewallHeader configured={configured} reachable={reachable} />
      <FirewallToolbar
        view={view}
        onViewChange={setView}
        configured={configured}
        decisionCount={rows.length}
        refreshing={decisions.isFetching}
        onRefresh={() => {
          void status.refetch();
          void decisions.refetch();
        }}
      />

      {view === "sources" ? (
        <BlocklistsPanel />
      ) : !configured ? (
        <FirewallDisabledCard />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableHeader>
              <TableRow className="border-b bg-muted/30 hover:bg-transparent">
                {[
                  "Value",
                  "Country",
                  "AS / Network",
                  "Scenario",
                  "Events",
                  "Action",
                  "Expires",
                  "Origin",
                ].map((h) => (
                  <TableHead
                    key={h}
                    className="h-8 text-[10px] font-semibold tracking-[0.06em] uppercase"
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-[13px] text-muted-foreground"
                  >
                    {reachable
                      ? "No active decisions — nothing is currently blocked."
                      : "Can't reach the CrowdSec agent — is the firewall profile running?"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((d, i) => (
                  <TableRow key={`${d.value}-${d.id ?? i}`} className="font-mono text-[12px]">
                    <TableCell className="text-foreground/90">
                      {d.value}
                      {d.scope !== "Ip" ? (
                        <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                          {d.scope}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.country ? (
                        <span title={d.country}>
                          {flagEmoji(d.country)} {d.country}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-[220px] truncate text-muted-foreground"
                      title={d.asName ?? undefined}
                    >
                      {d.asNumber || d.asName ? (
                        <>
                          {d.asNumber ? (
                            <span className="text-foreground/70">AS{d.asNumber}</span>
                          ) : null}
                          {d.asName ? <span className="ml-1.5">{d.asName}</span> : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate text-muted-foreground"
                      title={d.scenario}
                    >
                      {d.scenario || <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.eventsCount ?? <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(d.type === "ban" ? "text-destructive" : "text-amber-500")}
                      >
                        {d.type}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.duration}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.origin}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function FirewallHeader({ configured, reachable }: { configured: boolean; reachable: boolean }) {
  return (
    <div className="px-4 pt-4">
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold">Firewall</h1>
        {configured ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px]",
              reachable ? "text-success" : "text-destructive",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                reachable ? "animate-pulse bg-success" : "bg-destructive",
              )}
            />
            LAPI {reachable ? "reachable" : "unreachable"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground" />
            disabled
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        CrowdSec IP-reputation decisions enforced at the Caddy edge — banned IPs, ranges, and the
        community blocklist. Identity-blind; runs before the auth wall.
      </p>
    </div>
  );
}

function FirewallToolbar({
  view,
  onViewChange,
  configured,
  decisionCount,
  refreshing,
  onRefresh,
}: {
  view: View;
  onViewChange: (v: View) => void;
  configured: boolean;
  decisionCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        {(["decisions", "sources"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={cn(
              "rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
              view === v
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {v === "decisions" ? "Decisions" : "Sources"}
          </button>
        ))}
      </div>
      {view === "decisions" ? (
        <span className="text-[12px] text-muted-foreground">
          {configured
            ? `${decisionCount} active decision${decisionCount === 1 ? "" : "s"}`
            : "Not enabled"}
        </span>
      ) : null}
      <div className="flex-1" />
      {view === "decisions" ? (
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      ) : null}
    </div>
  );
}

/** ISO-3166 alpha-2 → flag emoji (regional indicator pair). "" for non-2-letter. */
function flagEmoji(cc: string): string {
  const code = cc.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)));
}
