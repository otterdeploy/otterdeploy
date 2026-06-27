/**
 * Schema explorer — the right-rail tables panel. Each table is collapsed by
 * default; clicking it expands an inline column list (name · type, PK badge)
 * fetched lazily via `information_schema`. This is a *reference* view: it never
 * navigates to the row browser, so you can inspect a schema while writing SQL.
 */

import { useState } from "react";

import { ArrowRight01Icon, Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import { shortType, type TableRef } from "../data/queries";
import { useTableColumns } from "../data/use-database";

interface SchemaExplorerProps {
  resourceId: string;
  tables: TableRef[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  /** True when the database has tables at all (drives "no matches" vs "no tables"). */
  hasTables: boolean;
}

export function SchemaExplorer({
  resourceId,
  tables,
  isLoading,
  isError,
  errorMessage,
  hasTables,
}: SchemaExplorerProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 px-1.5 py-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <p className="px-1.5 py-1 text-[12px] text-muted-foreground">{errorMessage}</p>;
  }
  if (tables.length === 0) {
    return (
      <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
        {hasTables ? "No matches." : "No tables yet."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {tables.map((tbl) => (
        <SchemaTableRow key={`${tbl.schema}.${tbl.name}`} resourceId={resourceId} table={tbl} />
      ))}
    </div>
  );
}

function SchemaTableRow({ resourceId, table }: { resourceId: string; table: TableRef }) {
  const [open, setOpen] = useState(false);

  // Only introspect once the table is expanded; cached thereafter.
  const q = useTableColumns({ resourceId, table, enabled: open });
  const rows = q.data?.rows ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] text-foreground transition-colors hover:bg-muted/60"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <HugeiconsIcon
          icon={Table01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="truncate" title={`${table.schema}.${table.name}`}>
          {table.schema === "public" ? table.name : `${table.schema}.${table.name}`}
        </span>
      </button>

      {open ? (
        <div className="mb-1 ml-[1.1rem] border-l pl-2">
          {q.isLoading ? (
            <p className="px-1.5 py-1 text-[11px] text-muted-foreground">Loading…</p>
          ) : q.isError ? (
            <p className="px-1.5 py-1 text-[11px] text-muted-foreground">Couldn’t load columns.</p>
          ) : rows.length === 0 ? (
            <p className="px-1.5 py-1 text-[11px] text-muted-foreground">No columns.</p>
          ) : (
            rows.map((r) => {
              const name = r[0] ?? "";
              const type = r[1] ?? "";
              const isPk = r[2] === "t";
              return (
                <div
                  key={name}
                  className="flex items-center justify-between gap-2 py-0.5 font-mono text-[12px]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-foreground">{name}</span>
                    {isPk ? (
                      <span className="shrink-0 rounded border px-1 py-px text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
                        PK
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground/70">{shortType(type)}</span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
