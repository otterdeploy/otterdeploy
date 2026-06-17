/**
 * Firewall view — CrowdSec IP-reputation decisions, rendered as a tab inside
 * the Edge Logs page (an edge-level concern: cluster-wide / identity-blind, so
 * it sits beside Access + Events at the org scope). Follows the same full-height
 * instrument layout as those views: header + status pill, a hairline toolbar,
 * then a full-bleed table that fills the remaining height.
 */
import { useState } from "react";
import { FirewallIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { BlocklistsPanel } from "./blocklists-panel";

import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
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
  const [view, setView] = useState<"decisions" | "sources">("decisions");

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">Firewall</h1>
          {s?.configured ? (
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
          CrowdSec IP-reputation decisions enforced at the Caddy edge — banned
          IPs, ranges, and the community blocklist. Identity-blind; runs before
          the auth wall.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-md border p-0.5">
          {(["decisions", "sources"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
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
            {s?.configured
              ? `${rows.length} active decision${rows.length === 1 ? "" : "s"}`
              : "Not enabled"}
          </span>
        ) : null}
        <div className="flex-1" />
        {view === "decisions" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void status.refetch();
              void decisions.refetch();
            }}
            disabled={decisions.isFetching}
          >
            {decisions.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        ) : null}
      </div>

      {/* Body */}
      {view === "sources" ? (
        <BlocklistsPanel />
      ) : !s?.configured ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <Card className="border-dashed p-5">
            <div className="flex items-start gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <HugeiconsIcon icon={FirewallIcon} strokeWidth={1.8} className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[13px] font-semibold">Firewall isn't enabled</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  The CrowdSec agent ships with otterstack — it just stays off
                  until you switch it on. Two steps:
                </p>
                <ol className="mt-3 space-y-2.5 text-[13px]">
                  <li className="flex gap-2.5">
                    <SetupStep n={1} />
                    <span className="text-muted-foreground">
                      Set <CodeChip>CROWDSEC_BOUNCER_KEY</CodeChip> to a strong
                      secret and{" "}
                      <CodeChip>CROWDSEC_LAPI_URL=http://crowdsec:8080</CodeChip>
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <SetupStep n={2} />
                    <span className="text-muted-foreground">
                      Start the bundled agent:{" "}
                      <CodeChip>docker compose --profile firewall up -d</CodeChip>
                    </span>
                  </li>
                </ol>
                <p className="mt-3 text-[12px] text-muted-foreground/80">
                  The edge gate wires in automatically — no Caddy rebuild. Phase 1
                  enforces the community IP blocklist.
                </p>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
            <TableHeader>
              <TableRow className="border-b bg-muted/30 hover:bg-transparent">
                {["Value", "Country", "AS / Network", "Scenario", "Events", "Action", "Expires", "Origin"].map(
                  (h) => (
                    <TableHead
                      key={h}
                      className="h-8 text-[10px] font-semibold uppercase tracking-[0.06em]"
                    >
                      {h}
                    </TableHead>
                  ),
                )}
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
                        <span className="ml-1.5 text-[10px] text-muted-foreground/70">{d.scope}</span>
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
                    <TableCell className="max-w-[220px] truncate text-muted-foreground" title={d.asName ?? undefined}>
                      {d.asNumber || d.asName ? (
                        <>
                          {d.asNumber ? <span className="text-foreground/70">AS{d.asNumber}</span> : null}
                          {d.asName ? <span className="ml-1.5">{d.asName}</span> : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground" title={d.scenario}>
                      {d.scenario || <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.eventsCount ?? <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className={cn(d.type === "ban" ? "text-destructive" : "text-amber-500")}>
                        {d.type}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{d.duration}</TableCell>
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

/** ISO-3166 alpha-2 → flag emoji (regional indicator pair). "" for non-2-letter. */
function flagEmoji(cc: string): string {
  const code = cc.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)),
  );
}

function CodeChip({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground/90">
      {children}
    </code>
  );
}

function SetupStep({ n }: { n: number }) {
  return (
    <span className="mt-px flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {n}
    </span>
  );
}
