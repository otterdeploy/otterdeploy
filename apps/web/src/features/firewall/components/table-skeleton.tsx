/**
 * Placeholder rows for a firewall table that hasn't answered yet.
 *
 * Every one of these tables previously rendered its EMPTY state while loading,
 * because an unresolved query and a genuinely empty result both arrive as
 * `rows.length === 0`. On a security surface that is not a cosmetic flaw: the
 * Enforcing Now table asserted "Nothing is blocked right now" before it had
 * any idea what was blocked, which is the one claim it must never make on
 * faith. Loading and empty are different states and now render differently.
 *
 * Skeleton rows rather than a spinner or a "Loading…" cell: DESIGN.md asks for
 * skeletons, and they hold the table's real geometry, so the header stops
 * jumping when the first page lands.
 */

import { Skeleton } from "@/shared/components/ui/skeleton";
import { TableCell, TableRow } from "@/shared/components/ui/table";

export function TableSkeletonRows({ columns, rows = 4 }: { columns: number; rows?: number }) {
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
