/**
 * The Table-browse layout for the Data studio — a left rail (table search +
 * SQL-console entry + table list) beside the shared results panel. Driven by
 * the {@link DataStudioController}.
 */

import type { ReactNode } from "react";

import { Search01Icon, SourceCodeIcon, Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import { type DataStudioController, errMessage } from "./use-data-studio";

export function TableBrowserView({
  studio,
  results,
}: {
  studio: DataStudioController;
  results: ReactNode;
}) {
  const t = studio.table;
  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Left rail — tables + a way into the SQL console */}
      <div className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
        <div className="space-y-2 p-2">
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={t.tableSearch}
              onChange={(e) => t.setTableSearch(e.target.value)}
              placeholder="Search tables…"
              className="h-7 pl-7 text-[12px]"
            />
          </div>
          <button
            type="button"
            onClick={() => t.setMode("sql")}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} className="size-3.5 shrink-0" />
            SQL console
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="px-1.5 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Tables {t.tables.length ? `· ${t.tables.length}` : ""}
          </div>
          <TableListRail studio={studio} />
        </div>
      </div>
      {/* Main — filters + grid + pagination */}
      <div className="flex min-w-0 flex-1 flex-col">{results}</div>
    </div>
  );
}

function TableListRail({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  if (t.tablesQuery.isLoading) return <SidebarSkeleton />;
  if (t.tablesQuery.isError) {
    return (
      <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
        {errMessage(t.tablesQuery.error)}
      </p>
    );
  }
  if (t.filteredTables.length === 0) {
    return (
      <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
        {t.tables.length ? "No matches." : "No tables yet."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {t.filteredTables.map((tbl) => {
        const active = t.selected?.schema === tbl.schema && t.selected?.name === tbl.name;
        return (
          <button
            key={`${tbl.schema}.${tbl.name}`}
            type="button"
            onClick={() => t.openTable(tbl)}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            <span className="truncate" title={`${tbl.schema}.${tbl.name}`}>
              {tbl.schema === "public" ? tbl.name : `${tbl.schema}.${tbl.name}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}
