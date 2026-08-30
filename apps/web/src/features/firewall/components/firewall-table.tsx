/**
 * The Firewall's shared table vocabulary.
 *
 * Every panel here used to invent its own: one table wrote 10px uppercase
 * headers, the next used the default sans ones; cells ran at 11, 12, 12.5 and
 * 13px, sometimes with the whole ROW in mono so a country name rendered as
 * machine output. DESIGN.md's two-cuts rule says sans for the human and mono
 * for the machine — that is a per-CELL decision, and it is made here once so
 * three tables can't drift apart again.
 *
 * The other job of this file is the small viewport. A nine-column table in a
 * 360px card is not a table, it is a horizontal scrollbar over the two columns
 * nobody needed. Below `md` each panel renders a stacked card per row instead
 * (same pattern as the audit list), and these are the pieces both layouts
 * share so the two never disagree about what a row says.
 */
import type { ReactNode } from "react";

import { Skeleton } from "@/shared/components/ui/skeleton";
import { TableCell, TableHead, TableRow } from "@/shared/components/ui/table";
import { flagEmoji } from "@/shared/lib/flag";
import { cn } from "@/shared/lib/utils";

/** Column header: the one heading style every firewall table uses. Private,
 *  because `HeadCells` below is the only way to build a header row — a caller
 *  reaching for the raw class is a caller about to drift from it. */
const TH_CLASS =
  "h-9 text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase";

/** Machine-readable cell text (IPs, ASNs, scenarios, origins, paths). */
export const MONO_CLASS = "font-mono text-xs";

/** Human-readable cell text (countries, relative times, labels). */
export const TEXT_CLASS = "text-xs";

/**
 * One table column: its heading, and the classes that both the heading and
 * every cell under it carry.
 *
 * Responsive column hiding lives here rather than in each row because a `<th>`
 * and its `<td>`s have to disappear together — the one time they didn't, the
 * body shifted a column left under an unchanged header.
 */
export interface Column {
  label: string;
  /** e.g. `hidden lg:table-cell` for a column only a wide screen has room for. */
  cell?: string;
}

/** A header row's cells. An empty label marks the actions column, which is
 *  headerless but still needs a `<th>` for the column count to line up. */
export function HeadCells({ columns }: { columns: readonly Column[] }) {
  return (
    <>
      {columns.map((c, i) => (
        <TableHead
          key={c.label || `col-${i}`}
          className={cn(TH_CLASS, c.cell, c.label === "" && "text-right")}
        >
          {c.label}
        </TableHead>
      ))}
    </>
  );
}

/**
 * Placeholder rows for a table that hasn't answered yet.
 *
 * Every one of these tables previously rendered its EMPTY state while loading,
 * because an unresolved query and a genuinely empty result both arrive as
 * `rows.length === 0`. On a security surface that is not cosmetic: the Blocked
 * table asserted "nothing is blocked right now" before it had any idea what
 * was blocked, which is the one claim it must never make on faith.
 */
export function TableSkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r} className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, c) => (
            <TableCell key={c} className="py-2.5">
              {/* Varied widths so the block reads as pending CONTENT rather
                  than as a rendered grid of grey bars. */}
              <Skeleton className="h-3.5" style={{ width: `${[70, 45, 60, 38][(r + c) % 4]}%` }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** The same pending state for the stacked mobile list. */
export function CardSkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/60">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex flex-col gap-2 p-4">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** A value we don't have. Dimmer than muted text, so an absent field reads as
 *  absent rather than as a value that happens to be short. */
export function Dash() {
  return <span className="text-muted-foreground/40">–</span>;
}

/** Flag + ISO code. Sans, not mono: a country is a human fact. */
export function Country({ code }: { code: string | null }) {
  if (!code) return <Dash />;
  const flag = flagEmoji(code);
  return (
    <span className="whitespace-nowrap" title={code}>
      {flag ? `${flag} ` : ""}
      {code}
    </span>
  );
}

/** Autonomous system, as `AS13335 Cloudflare, Inc.`. */
export function Network({ number, name }: { number: string | null; name: string | null }) {
  if (!number && !name) return <Dash />;
  return (
    <span className="min-w-0" title={name ?? undefined}>
      {number ? <span className="font-mono text-foreground/70">AS{number}</span> : null}
      {name ? <span className={cn(number && "ml-1.5")}>{name}</span> : null}
    </span>
  );
}

/** A coloured dot, the status vocabulary's carrier in both layouts. */
export function StatusDot({ tone }: { tone: "live" | "ended" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "live" ? "bg-info" : "bg-muted-foreground/50",
      )}
    />
  );
}

/** The message a table shows when it has an answer and the answer is nothing. */
export function EmptyRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={columns}
        className="px-4 py-12 text-center text-[13px] text-muted-foreground"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

/** Same, for the stacked list. */
export function EmptyCard({ children }: { children: ReactNode }) {
  return <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * One stacked row on a small viewport: a body that may toggle a detail pane,
 * and a fixed action on its right.
 *
 * The action is a sibling of the toggle rather than a child of it — a button
 * inside a button is invalid, and the first attempt at this put "Unblock" on a
 * fourth line of its own, which turned every row into a 90px block of mostly
 * empty space.
 */
export function RowCard({
  onClick,
  expanded,
  action,
  children,
}: {
  onClick?: () => void;
  expanded?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors",
        onClick && "hover:bg-muted/40 has-aria-expanded:bg-muted/40",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 flex-col gap-1.5 text-left"
        >
          {children}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
      )}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The dot that separates facts on one line of a stacked card. */
export function Sep() {
  return <span className="text-muted-foreground/40">·</span>;
}
