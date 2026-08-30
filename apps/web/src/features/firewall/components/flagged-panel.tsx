/**
 * Flagged: client IPs probing the org's domains with scanner-style paths
 * (/.env, /actuator, *.php, ?cmd=…). The "review these" surface — each row is
 * one-click blockable at the CrowdSec edge, and the whole set is mass-blockable
 * from the toolbar. Independent of whether CrowdSec is configured (the data is
 * edge-log-derived); blocking just needs the agent running to enforce.
 *
 * Defaults to ALL TIME, read from the durable probe rollup. The bounded windows
 * aggregate raw access logs instead and so stop at their retention (7 days by
 * default): that is the honest ceiling, which is why the empty state names the
 * window rather than letting an empty 7d view read as "nobody ever probed us".
 */
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/shared/components/ui/table";
import { CLOCK_EXACT, clockFormatter, epochMsFromIso } from "@/shared/lib/clock";
import { timeAgo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

import type { FlaggedRow } from "../data";
import type { Column } from "./firewall-table";

import {
  CardSkeletonRows,
  Country,
  EmptyCard,
  EmptyRow,
  HeadCells,
  MONO_CLASS,
  RowCard,
  Sep,
  TableSkeletonRows,
  TEXT_CLASS,
} from "./firewall-table";

/** Same rule as the Blocked table: the columns an operator scans (who, where,
 *  how hard, against what) always show, and "First seen" — the one fact the
 *  "Last seen" beside it already implies — is the first to go as the viewport
 *  narrows. */
const COLUMNS: readonly Column[] = [
  { label: "Client IP" },
  { label: "Country" },
  { label: "Probes" },
  { label: "Sample paths" },
  { label: "First seen", cell: "hidden lg:table-cell" },
  { label: "Last seen" },
  { label: "" },
];

/** Probes routinely date from months ago in the all-time view, where a bare
 *  wall clock says nothing — so the cell is relative and the exact stamp lives
 *  on hover. */
const format = clockFormatter(CLOCK_EXACT);
const exactTime = (iso: string): string | undefined => {
  const ms = epochMsFromIso(iso);
  return ms === null ? undefined : format(ms);
};

export function FlaggedPanel({
  rows,
  total,
  loading,
  searching,
  bannedIps,
  onBlock,
  blocking,
}: {
  rows: readonly FlaggedRow[];
  total: number;
  loading: boolean;
  searching: boolean;
  bannedIps: ReadonlySet<string>;
  onBlock: (ip: string) => void;
  blocking: boolean;
}) {
  const { t } = useTranslation();
  const empty = searching
    ? "No probing IP matches that search."
    : "No suspicious probing in this window. Scanner traffic to your domains appears here.";

  const action = (row: FlaggedRow) =>
    bannedIps.has(row.ip) ? (
      <span className="text-xs text-muted-foreground" title={t("firewall.alreadyBanned")}>
        Blocked
      </span>
    ) : (
      <Button
        variant="outline"
        size="xs"
        className="text-destructive hover:text-destructive"
        onClick={() => onBlock(row.ip)}
        disabled={blocking}
      >
        Block
      </Button>
    );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="divide-y divide-border/60 md:hidden">
        {loading && rows.length === 0 ? (
          <CardSkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyCard>{empty}</EmptyCard>
        ) : (
          rows.map((row) => (
            <RowCard key={row.ip} action={action(row)}>
              <span className="flex flex-wrap items-center gap-x-1.5">
                <span className={cn(MONO_CLASS, "[overflow-wrap:anywhere]")}>{row.ip}</span>
                <span className="text-xs text-destructive">{row.count} probes</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <Country code={row.country} />
                <Sep />
                <span>last {timeAgo(row.lastSeen)}</span>
                <Sep />
                <span>first {timeAgo(row.firstSeen)}</span>
              </span>
              <span
                className={cn(MONO_CLASS, "line-clamp-2 text-muted-foreground")}
                title={row.samplePaths.join("\n")}
              >
                {row.samplePaths.join("  ·  ")}
              </span>
            </RowCard>
          ))
        )}
      </div>

      <Table className="hidden md:table [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            <HeadCells columns={COLUMNS} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && rows.length === 0 ? (
            <TableSkeletonRows columns={COLUMNS.length} />
          ) : rows.length === 0 ? (
            <EmptyRow columns={COLUMNS.length}>{empty}</EmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.ip} className={TEXT_CLASS}>
                <TableCell className={cn(MONO_CLASS, "whitespace-nowrap text-foreground/90")}>
                  {row.ip}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Country code={row.country} />
                </TableCell>
                <TableCell className="text-destructive">{row.count}</TableCell>
                <TableCell
                  className={cn(MONO_CLASS, "max-w-[24rem] truncate text-muted-foreground")}
                  title={row.samplePaths.join("\n")}
                >
                  {row.samplePaths.join("  ·  ")}
                </TableCell>
                <TableCell
                  className="hidden whitespace-nowrap text-muted-foreground lg:table-cell"
                  title={exactTime(row.firstSeen)}
                >
                  {timeAgo(row.firstSeen)}
                </TableCell>
                <TableCell
                  className="whitespace-nowrap text-muted-foreground"
                  title={exactTime(row.lastSeen)}
                >
                  {timeAgo(row.lastSeen)}
                </TableCell>
                <TableCell className="text-right">{action(row)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {searching && rows.length > 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {rows.length} of {total}
        </p>
      ) : null}
    </div>
  );
}
