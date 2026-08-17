/**
 * Flagged IPs: client IPs probing the org's domains with scanner-style paths
 * (/.env, /actuator, *.php, ?cmd=…). The "review these IPs" surface: each row is
 * one-click blockable at the CrowdSec edge, and the whole set is mass-blockable.
 * Independent of whether CrowdSec is configured (the data is edge-log-derived);
 * Block just needs the agent running to enforce.
 *
 * Defaults to ALL TIME, read from the durable probe rollup. The bounded windows
 * aggregate raw access logs instead and so stop at their retention (7 days by
 * default): that's the honest ceiling, and the footnote below the table says so
 * rather than letting an empty 7d view read as "nobody ever probed us".
 */
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { flagEmoji } from "@/shared/lib/flag";
import { timeAgo } from "@/shared/lib/time";
import { orpc } from "@/shared/server/orpc";

import { BlockAllButton } from "../../edge-logs/components/edge-logs-block-ip";
import { Segmented } from "../../edge-logs/components/edge-logs-shared";
import { useEdgeBans } from "../../edge-logs/data/use-edge-bans";

/** `all` first: it's the default, and it's the only one that answers "has this
 *  IP ever touched us". The rest are the same windows the edge-log views use. */
const WINDOWS = ["all", "1h", "6h", "24h", "7d"] as const;
type FlaggedWindow = (typeof WINDOWS)[number];

/** Reads as a sentence tail in both the header and the empty state. */
const WINDOW_LABEL: Record<FlaggedWindow, string> = {
  all: "on record",
  "1h": "in the last hour",
  "6h": "in the last 6 hours",
  "24h": "in the last 24 hours",
  "7d": "in the last 7 days",
};

function isFlaggedWindow(v: string): v is FlaggedWindow {
  return WINDOWS.some((w) => w === v);
}

export function FlaggedPanel() {
  const { t } = useTranslation();
  const [range, setRange] = useState<FlaggedWindow>("all");
  const flagged = useQuery({
    ...orpc.firewall.flagged.queryOptions({ input: { window: range } }),
    refetchInterval: 15_000,
  });
  // Active bans flip already-blocked rows to a passive "Blocked" state; the
  // hook refreshes both after each block.
  const { bannedIps, block, blockMany } = useEdgeBans(() => void flagged.refetch());

  const rows = flagged.data ?? [];
  const unblockedIps = (flagged.data ?? [])
    .reduce<string[]>((acc, r) => {
      if (!bannedIps.has(r.ip)) acc.push(r.ip);
      return acc;
    }, [])
    .slice(0, 100);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <span className="text-[12px] text-muted-foreground">
          Client IPs probing your domains for secrets and known exploits {WINDOW_LABEL[range]}.
          Blocking rejects every future request from that IP at the edge (403).
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            options={WINDOWS}
            value={range}
            onChange={(v) => {
              if (isFlaggedWindow(v)) setRange(v);
            }}
          />
          {unblockedIps.length > 0 ? (
            <BlockAllButton
              count={unblockedIps.length}
              blocking={blockMany.isPending}
              onConfirm={() => blockMany.mutate({ ips: unblockedIps })}
            />
          ) : null}
        </div>
      </div>
      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            {["Client IP", "Country", "Probes", "Sample paths", "First seen", "Last seen", ""].map(
              (h) => (
                <TableHead
                  key={h || "row-actions"}
                  className="h-8 text-[10px] font-semibold tracking-[0.06em] uppercase"
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
                colSpan={7}
                className="py-10 text-center text-[13px] text-muted-foreground"
              >
                {flagged.isLoading
                  ? "Loading…"
                  : `No suspicious probing ${WINDOW_LABEL[range]}. Scanner traffic to your domains appears here.`}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.ip} className="font-mono text-[12px]">
                <TableCell className="text-foreground/90">{r.ip}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {r.country ? (
                    <span title={r.country}>
                      {flagEmoji(r.country)} {r.country}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">–</span>
                  )}
                </TableCell>
                <TableCell className="text-destructive">{r.count}</TableCell>
                <TableCell
                  className="max-w-[360px] truncate text-muted-foreground"
                  title={r.samplePaths.join("\n")}
                >
                  {r.samplePaths.join("  ·  ")}
                </TableCell>
                {/* Relative, not a wall-clock time: the all-time view routinely
                    shows probes from months ago, where "14:32:45" says nothing.
                    Exact timestamp on hover. */}
                <TableCell
                  className="whitespace-nowrap text-muted-foreground"
                  title={new Date(r.firstSeen).toLocaleString()}
                >
                  {timeAgo(r.firstSeen)}
                </TableCell>
                <TableCell
                  className="whitespace-nowrap text-muted-foreground"
                  title={new Date(r.lastSeen).toLocaleString()}
                >
                  {timeAgo(r.lastSeen)}
                </TableCell>
                <TableCell className="text-right">
                  {bannedIps.has(r.ip) ? (
                    <span
                      className="text-[11px] text-muted-foreground"
                      title={t("firewall.alreadyBanned")}
                    >
                      Blocked
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] text-destructive hover:text-destructive"
                      onClick={() => block.mutate({ ip: r.ip })}
                      disabled={block.isPending}
                    >
                      Block
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {/* Say where the numbers come from. A bounded window can only see as far
          back as raw access logs are kept, so an empty 7d table is not evidence
          of a quiet 7 days on an install with 3-day retention. */}
      <p className="px-4 py-3 text-[11px] text-muted-foreground/70">
        {range === "all"
          ? "All time reads durable probe counters, written as requests arrive and never aged out — they outlive the access logs they came from."
          : "Bounded windows aggregate raw access logs, so they reach back only as far as the edge-log retention window. Switch to all time for the full record."}
      </p>
    </div>
  );
}
