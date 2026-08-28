import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

/**
 * History: every decision we recorded, including the ones CrowdSec has since
 * deleted.
 *
 * This is the tab that answers "what happened while I wasn't looking". The
 * Decisions tab reads the LAPI live, so a ban vanishes from it the moment its
 * TTL elapses — an operator arriving an hour after an SSH brute-force saw an
 * empty table and had no way to learn anything happened. Our recorder writes
 * each decision down as it sees it and stamps the ones that end, so the record
 * outlives the enforcement.
 *
 * Expanding a row asks CrowdSec for the alerts behind that IP: which scenario
 * fired, how many events tripped it, over what window. That read is per-row on
 * purpose (see api/routers/firewall/alerts-read for why it is never bulk).
 */
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/shared/components/ui/skeleton";
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
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { FirewallWindow, HistoryState } from "../data";

import { Segmented } from "../../edge-logs/components/edge-logs-shared";
import { historyQuery } from "../data";

/** Ascending, then `all` — reads as a scale rather than a shuffled set. The
 *  default is 7d: long enough to cover a weekend, short enough to stay fast. */
const WINDOWS = ["1h", "6h", "24h", "7d", "all"] as const;
const WINDOW_LABEL: Record<FirewallWindow, string> = {
  all: "on record",
  "1h": "in the last hour",
  "6h": "in the last 6 hours",
  "24h": "in the last 24 hours",
  "7d": "in the last 7 days",
};

/** The label IS the value: Segmented renders what it is given, and these read
 *  as words an operator would use rather than as enum members. */
const STATE_OPTIONS = ["all", "enforcing", "expired"] as const;
type StateOption = (typeof STATE_OPTIONS)[number];
const STATE_TO_QUERY: Record<StateOption, HistoryState> = {
  all: "all",
  enforcing: "active",
  expired: "ended",
};

// `.some` over the tuple rather than `includes` on a widened copy: the repo
// bans type assertions, and this is a real check either way.
function isWindow(v: string): v is FirewallWindow {
  return WINDOWS.some((w) => w === v);
}
function isStateOption(v: string): v is StateOption {
  return STATE_OPTIONS.some((o) => o === v);
}

export function HistoryPanel() {
  const [range, setRange] = useState<FirewallWindow>("7d");
  const [state, setState] = useState<StateOption>("all");
  const [openValue, setOpenValue] = useState<string | null>(null);

  const history = useQuery(historyQuery(range, STATE_TO_QUERY[state]));
  const rows = history.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          Every decision CrowdSec has made {WINDOW_LABEL[range]}, including ones that have since
          expired. Bans are temporary by design — this is what the live Decisions tab drops.
        </p>
        <Segmented
          options={STATE_OPTIONS}
          value={state}
          onChange={(v) => {
            if (isStateOption(v)) setState(v);
          }}
        />
        <Segmented
          options={WINDOWS}
          value={range}
          onChange={(v) => {
            if (isWindow(v)) setRange(v);
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {history.isLoading && rows.length === 0 ? (
          <div className="flex flex-col gap-2.5 px-4 py-4">
            {[70, 45, 60, 38].map((w, i) => (
              <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            {`No decisions recorded ${WINDOW_LABEL[range]}. Bans appear here as CrowdSec makes them, and stay after they expire.`}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <HistoryRow
                  key={row.id}
                  row={row}
                  open={openValue === row.value}
                  onToggle={() => {
                    setOpenValue(openValue === row.value ? null : row.value);
                  }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** One recorded decision, straight off the contract. */
type Row = InferRouterOutputs<AppRouter>["firewall"]["history"][number];

function HistoryRow({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  const live = row.endedAt === null;
  return (
    <>
      <TableRow
        onClick={onToggle}
        className="cursor-pointer"
        aria-expanded={open}
        title="Show the events behind this decision"
      >
        <TableCell className="font-mono text-[12.5px]">{row.value}</TableCell>
        <TableCell className="text-[12.5px] text-muted-foreground">
          {row.country ? `${flagEmoji(row.country)} ${row.country}` : "—"}
        </TableCell>
        <TableCell className="font-mono text-[12px] text-muted-foreground">
          {row.scenario}
        </TableCell>
        <TableCell className="font-mono text-[12px] text-muted-foreground">{row.origin}</TableCell>
        <TableCell className="text-[12.5px] text-muted-foreground">
          {timeAgo(row.firstSeenAt)}
        </TableCell>
        <TableCell>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[12.5px]",
              // Blue, not red: an enforced ban is the firewall WORKING. Red
              // here made a healthy block look like an incident.
              live ? "text-info" : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", live ? "bg-info" : "bg-muted-foreground/50")}
            />
            {/* An expired ban is the normal end of a decision's life, not a
                failure — so it reads as a fact with a time, not a warning. */}
            {live ? `enforcing · ${row.duration ?? ""}` : `expired ${timeAgo(row.endedAt ?? "")}`}
          </span>
        </TableCell>
      </TableRow>
      {open && <AlertDetail value={row.value} />}
    </>
  );
}

/** The events behind one decision, fetched only when a row is opened. */
function AlertDetail({ value }: { value: string }) {
  const alerts = useQuery({
    ...orpc.firewall.alerts.queryOptions({ input: { value } }),
    // The past doesn't change, so once fetched this row's detail is good for
    // the rest of the session.
    staleTime: 5 * 60_000,
  });

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={6} className="px-4 py-3">
        {alerts.isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading events…</p>
        ) : !alerts.data?.available ? (
          // Not an error: the decision record stands on its own, we just
          // couldn't read the detail behind it. Says "couldn't read" rather
          // than "unreachable" — the agent may be perfectly reachable and
          // simply not answering this query, and a flat contradiction of the
          // header's own reachable pill is worse than a vaguer sentence.
          <p className="text-[12.5px] text-muted-foreground">
            Couldn't read the events behind this decision. The record above is ours and stays either
            way.
          </p>
        ) : alerts.data.alerts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            CrowdSec no longer holds the events for this decision.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.data.alerts.map((alert, i) => (
              <li key={alert.id ?? i} className="text-[12.5px]">
                <span className="font-mono text-muted-foreground">{alert.scenario}</span>
                {alert.eventsCount != null && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {alert.eventsCount} event{alert.eventsCount === 1 ? "" : "s"}
                  </span>
                )}
                {alert.startedAt && (
                  <span className="text-muted-foreground">{` · ${timeAgo(alert.startedAt)}`}</span>
                )}
                {alert.message && (
                  <div className="mt-0.5 text-muted-foreground/80">{alert.message}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
    </TableRow>
  );
}
