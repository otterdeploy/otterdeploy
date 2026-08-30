/**
 * One blocked decision, in both of the shapes it has to take: a table row on a
 * real screen and a stacked card on a phone.
 *
 * They live in the same file deliberately. The two layouts say the same things
 * in the same words — the status vocabulary, the events suffix, the Unblock
 * affordance are each written once and shared — because the previous split (a
 * table here, nothing at all below `md`) is exactly how the two drifted into
 * disagreeing about what a row means.
 */
import { useQuery } from "@tanstack/react-query";

import { TableCell, TableRow } from "@/shared/components/ui/table";
import { timeAgo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { BlockedRow } from "../blocked-rows";
import type { Column } from "./firewall-table";

import { isExpandable, isUnblockable } from "../blocked-rows";
import {
  Country,
  Dash,
  MONO_CLASS,
  Network,
  RowCard,
  Sep,
  StatusDot,
  TEXT_CLASS,
} from "./firewall-table";

/**
 * Eight columns is right on a wide screen and wrong on a laptop half-window,
 * where the last of them used to sit off the edge behind a horizontal scroll.
 * Network, Origin and Started drop out as the viewport narrows, in that order:
 * each is still readable in the row's own expanded detail, and none of them is
 * what an operator is scanning for. Value, Country, Scenario and Status —
 * who, where, why, and for how long — never drop.
 */
export const BLOCKED_COLUMNS: readonly Column[] = [
  { label: "Value" },
  { label: "Country" },
  { label: "Network", cell: "hidden xl:table-cell" },
  { label: "Scenario" },
  { label: "Origin", cell: "hidden lg:table-cell" },
  { label: "Started", cell: "hidden lg:table-cell" },
  { label: "Status" },
  { label: "" },
];

/** The responsive class for column `i`, so a cell can never disagree with its
 *  own heading about which viewports it appears on. */
const colClass = (i: number) => BLOCKED_COLUMNS[i]?.cell;

interface RowProps {
  row: BlockedRow;
  open: boolean;
  onToggle: () => void;
  onUnblock: (ip: string) => void;
  unblocking: boolean;
}

/** Blue, not red: an enforced ban is the firewall WORKING, and red here made a
 *  healthy block look like an incident. An expired one is the normal end of a
 *  decision's life, so it reads as a fact with a time, not as a warning. */
function Status({ row }: { row: BlockedRow }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        row.enforcing ? "text-info" : "text-muted-foreground",
      )}
    >
      <StatusDot tone={row.enforcing ? "live" : "ended"} />
      {row.enforcing
        ? row.remaining
          ? `${row.type} · ${row.remaining}`
          : row.type
        : `expired ${timeAgo(row.endedAt ?? "")}`}
    </span>
  );
}

function Scenario({ row }: { row: BlockedRow }) {
  if (!row.scenario) return <Dash />;
  return (
    <span title={row.scenario}>
      {row.scenario}
      {/* Folded in from what used to be its own column, which was empty for
          every imported-blocklist row — that is, for most of the table. */}
      {row.eventsCount === null ? null : (
        <span className="ml-1.5 text-muted-foreground/70">· {row.eventsCount} ev</span>
      )}
    </span>
  );
}

function UnblockButton({ row, onUnblock, unblocking }: Omit<RowProps, "open" | "onToggle">) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // The row itself toggles the alert detail; the action must not.
        e.stopPropagation();
        onUnblock(row.value);
      }}
      disabled={unblocking}
      className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      Unblock
    </button>
  );
}

export function BlockedTableRow({ row, open, onToggle, onUnblock, unblocking }: RowProps) {
  const expandable = isExpandable(row);
  return (
    <>
      <TableRow
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? open : undefined}
        title={expandable ? "Show the events behind this decision" : undefined}
        className={cn(TEXT_CLASS, expandable && "cursor-pointer")}
      >
        <TableCell className={cn(MONO_CLASS, "whitespace-nowrap text-foreground/90")}>
          {row.value}
          {row.scope.toLowerCase() === "ip" ? null : (
            <span className="ml-1.5 font-sans text-[11px] text-muted-foreground/70">
              {row.scope}
            </span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">
          <Country code={row.country} />
        </TableCell>
        <TableCell className={cn(colClass(2), "max-w-[15rem] truncate text-muted-foreground")}>
          <Network number={row.asNumber} name={row.asName} />
        </TableCell>
        <TableCell className={cn(MONO_CLASS, "max-w-[16rem] truncate text-muted-foreground")}>
          <Scenario row={row} />
        </TableCell>
        <TableCell
          className={cn(MONO_CLASS, colClass(4), "whitespace-nowrap text-muted-foreground")}
        >
          {row.origin}
        </TableCell>
        <TableCell className={cn(colClass(5), "whitespace-nowrap text-muted-foreground")}>
          {row.startedAt ? timeAgo(row.startedAt) : <Dash />}
        </TableCell>
        <TableCell>
          <Status row={row} />
        </TableCell>
        <TableCell className="text-right">
          {row.enforcing && isUnblockable(row) ? (
            <UnblockButton row={row} onUnblock={onUnblock} unblocking={unblocking} />
          ) : null}
        </TableCell>
      </TableRow>
      {open && expandable ? (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={BLOCKED_COLUMNS.length} className="px-4 py-3">
            <AlertDetail value={row.value} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function BlockedCard({ row, open, onToggle, onUnblock, unblocking }: RowProps) {
  const expandable = isExpandable(row);
  return (
    <div>
      <RowCard
        onClick={expandable ? onToggle : undefined}
        expanded={expandable ? open : undefined}
        action={
          row.enforcing && isUnblockable(row) ? (
            <UnblockButton row={row} onUnblock={onUnblock} unblocking={unblocking} />
          ) : null
        }
      >
        <span className={cn(MONO_CLASS, "[overflow-wrap:anywhere] text-foreground/90")}>
          {row.value}
          {row.scope.toLowerCase() === "ip" ? null : (
            <span className="ml-1.5 font-sans text-[11px] text-muted-foreground/70">
              {row.scope}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <Status row={row} />
          <Sep />
          <Country code={row.country} />
          <Sep />
          <Network number={row.asNumber} name={row.asName} />
        </span>
        <span
          className={cn(
            MONO_CLASS,
            "flex flex-wrap items-center gap-x-1.5 [overflow-wrap:anywhere] text-muted-foreground",
          )}
        >
          <Scenario row={row} />
          <Sep />
          <span>{row.origin}</span>
          {row.startedAt ? (
            <>
              <Sep />
              <span>{timeAgo(row.startedAt)}</span>
            </>
          ) : null}
        </span>
      </RowCard>
      {open && expandable ? (
        <div className="bg-muted/20 px-4 py-3">
          <AlertDetail value={row.value} />
        </div>
      ) : null}
    </div>
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

  if (alerts.isLoading) return <p className="text-xs text-muted-foreground">Loading events…</p>;
  if (!alerts.data?.available) {
    // Not an error: the decision record stands on its own, we just couldn't
    // read the detail behind it. "Couldn't read" rather than "unreachable" —
    // the agent may be perfectly reachable and simply not answering this
    // query, and flatly contradicting the header's own pill is worse than a
    // vaguer sentence.
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t read the events behind this decision. The record above is ours and stays
        either way.
      </p>
    );
  }
  if (alerts.data.alerts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        CrowdSec no longer holds the events for this decision.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {alerts.data.alerts.map((alert, i) => (
        <li key={alert.id ?? i} className="text-xs">
          <span className="font-mono text-muted-foreground">{alert.scenario}</span>
          {alert.eventsCount === null ? null : (
            <span className="text-muted-foreground">
              {` · ${alert.eventsCount} event${alert.eventsCount === 1 ? "" : "s"}`}
            </span>
          )}
          {alert.startedAt ? (
            <span className="text-muted-foreground">{` · ${timeAgo(alert.startedAt)}`}</span>
          ) : null}
          {alert.message ? (
            <div className="mt-0.5 text-muted-foreground/80">{alert.message}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
