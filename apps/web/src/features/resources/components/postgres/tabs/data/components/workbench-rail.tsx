/**
 * The workbench rail: which database, which table, which schema object.
 *
 * One list, three kinds of destination — the connection at the top, the
 * database's tables in the middle, its non-table objects below them, and a way
 * into the SQL console pinned at the bottom. Definitions sit here rather than
 * behind a tab in the content area because "show me the indexes" is a place you
 * go, not a mode the open table is in; they are database-wide and need no table
 * selected at all.
 *
 * Shared verbatim by the persistent `sm`+ column and the mobile sheet, so the
 * two cannot drift.
 */
import type { ReactNode } from "react";

import {
  LinkSquare01Icon,
  MenuSquareIcon,
  Search01Icon,
  SortingAZ01Icon,
  SourceCodeIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

import { prefetchRowsWindow } from "../data/rows-window";
import { useDefinitions } from "../data/use-database";
import { type DataStudioController, errMessage } from "../use-data-studio";
import { DEFINITION_SECTIONS } from "./definitions-view";
import { compactCount, SidebarSkeleton } from "./workbench-rail-bits";

/** Sentinel: Select needs a non-empty value, "every schema" is `null` in state. */
const ALL_SCHEMAS = "__all__";

export function RailContent({
  studio,
  onPick,
}: {
  studio: DataStudioController;
  onPick?: () => void;
}) {
  const t = studio.table;
  // Same query the Definitions view reads, so the numbers in the rail and the
  // numbers in the view can never disagree, and opening a section is warm.
  const definitions = useDefinitions(t.target);
  const definitionCounts = {
    indexes: definitions.data?.indexes.length,
    constraints: definitions.data?.constraints.length,
    enums: definitions.data?.enums.length,
  };
  return (
    <>
      {/* Only when there is a choice to make. A database whose tables all live
          in `public` gains nothing from a one-option dropdown. */}
      {t.schemas.length > 1 ? (
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Schema
          </span>
          <Select
            value={t.activeSchema ?? ALL_SCHEMAS}
            onValueChange={(v) => t.setActiveSchema(v === ALL_SCHEMAS ? null : v)}
          >
            <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent px-1 font-mono text-[11px] shadow-none hover:bg-muted/60">
              {/* Render the label, not the value: the sentinel is an
                  implementation detail and `__all__` is not a schema. */}
              <SelectValue>{t.activeSchema ?? "all schemas"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SCHEMAS} className="font-mono text-[11px]">
                all schemas
              </SelectItem>
              {t.schemas.map((s) => (
                <SelectItem key={s} value={s} className="font-mono text-[11px]">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="p-2 pb-1.5">
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
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* Counts the list below it, not the database. Saying "83" over a list
            of eleven `public` tables is the label disagreeing with the thing
            it labels. */}
        <RailSectionLabel>
          Tables {t.filteredTables.length ? `· ${t.filteredTables.length}` : ""}
        </RailSectionLabel>
        <TableListRail studio={studio} onPick={onPick} />

        {/* Definitions are database-wide, so they sit beside the table list
            rather than inside any one table — the same shape the approved
            layout has. Each is a destination, not a tab you find later. */}
        <RailSectionLabel className="pt-3">Definitions</RailSectionLabel>
        <div className="flex flex-col gap-0.5">
          {DEFINITION_SECTIONS.map((s) => (
            <RailItem
              key={s.id}
              icon={DEFINITION_ICONS[s.id]}
              label={s.label}
              count={definitionCounts[s.id]}
              active={
                t.mode === "table" && t.tableView === "definitions" && t.definitionsSection === s.id
              }
              onClick={() => {
                t.setMode("table");
                t.setTableView("definitions");
                t.setDefinitionsSection(s.id);
                onPick?.();
              }}
            />
          ))}
        </div>
      </div>

      {/* Pinned to the bottom: the two things you reach for that are not a
          table — write a query, or leave the browser behind. */}
      <div className="shrink-0 border-t p-1.5">
        <RailItem
          icon={SourceCodeIcon}
          label="New query"
          shortcut="⌘K"
          active={t.mode === "sql"}
          onClick={() => {
            t.setMode("sql");
            onPick?.();
          }}
        />
      </div>
    </>
  );
}

const DEFINITION_ICONS = {
  indexes: SortingAZ01Icon,
  constraints: LinkSquare01Icon,
  enums: MenuSquareIcon,
} as const;

function RailSectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-1.5 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One rail destination. Same shape as a table row so the rail reads as one list. */
function RailItem({
  icon,
  label,
  count,
  shortcut,
  active,
  onClick,
}: {
  icon: typeof SourceCodeIcon;
  label: string;
  /** How many of the thing there are, right-aligned like the table counts. */
  count?: number;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={railItemClass(active)}>
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="shrink-0 font-mono text-[10px] font-normal opacity-55">{count}</span>
      )}
      {shortcut === undefined ? null : (
        <span className="shrink-0 font-mono text-[10px] opacity-55">{shortcut}</span>
      )}
    </button>
  );
}

/**
 * One rail row's chrome, shared by tables and destinations so the two lists
 * read as one.
 *
 * Selection is a primary-tinted wash with primary text: still unmistakably
 * the accent in a list of eighty near-identical rows, without a solid block
 * of it blowing the accent budget (DESIGN.md keeps blue ≤10% of a screen).
 */
function railItemClass(active: boolean): string {
  return cn(
    "flex h-7 w-full items-center gap-2 rounded-md pr-1.5 pl-2 text-left text-[13px] transition-colors",
    active
      ? "bg-primary/10 font-medium text-primary"
      : "text-foreground/80 hover:bg-accent hover:text-foreground",
  );
}

function TableListRail({ studio, onPick }: { studio: DataStudioController; onPick?: () => void }) {
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
        // Only while the content area is actually showing this table: with
        // Definitions or the SQL editor open, lighting the table row too put
        // two "you are here" markers on screen at once.
        const active =
          t.mode === "table" &&
          t.tableView !== "definitions" &&
          t.selected?.schema === tbl.schema &&
          t.selected?.name === tbl.name;
        return (
          <button
            key={`${tbl.schema}.${tbl.name}`}
            type="button"
            onMouseEnter={() => prefetchRowsWindow(t.target, tbl)}
            onFocus={() => prefetchRowsWindow(t.target, tbl)}
            onClick={() => {
              t.openTable(tbl);
              onPick?.();
            }}
            className={railItemClass(active)}
          >
            <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={`${tbl.schema}.${tbl.name}`}>
              {/* Qualified only in "all schemas": with one schema active every
                  row would repeat the same prefix and truncate the name. */}
              {t.activeSchema === null ? `${tbl.schema}.${tbl.name}` : tbl.name}
            </span>
            {/* Planner estimate (pg_class.reltuples), never a count(*). */}
            {tbl.estimatedRows != null ? (
              <span className="shrink-0 font-mono text-[10px] font-normal opacity-55">
                {compactCount(tbl.estimatedRows)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
