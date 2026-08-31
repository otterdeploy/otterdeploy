import type { ReactNode } from "react";
import { useState } from "react";

import {
  Key01Icon,
  PlusSignIcon,
  Search01Icon,
  SourceCodeIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { DefinitionSection } from "./components/definitions-view";
import type { TableRef } from "./data/queries";
import type { DataStudioController } from "./use-data-studio";

import { useDefinitions } from "./data/use-database";

const definitionLabels: ReadonlyArray<{
  id: DefinitionSection;
  label: string;
}> = [
  { id: "indexes", label: "Indexes" },
  { id: "constraints", label: "Constraints" },
  { id: "enums", label: "Enums" },
];

export function WorkbenchRail({
  studio,
  connection,
  onOpenTable,
  onOpenDefinition,
  onNewQuery,
  className,
}: {
  studio: DataStudioController;
  connection: ReactNode;
  onOpenTable: (table: TableRef) => void;
  onOpenDefinition: (section: DefinitionSection) => void;
  onNewQuery: () => void;
  className?: string;
}) {
  const table = studio.table;
  const [schema, setSchema] = useState("all");
  const definitions = useDefinitions(table.target);
  const schemas = [...new Set(table.tables.map((item) => item.schema || "default"))].sort();
  const visibleTables = table.filteredTables.filter(
    (item) => schema === "all" || (item.schema || "default") === schema,
  );
  const counts = {
    indexes: definitions.data?.indexes.length ?? 0,
    constraints: definitions.data?.constraints.length ?? 0,
    enums: definitions.data?.enums.length ?? 0,
  };

  return (
    <aside className={cn("hidden w-60 shrink-0 flex-col border-r bg-muted/15 md:flex", className)}>
      <div className="border-b p-1.5">{connection}</div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
        <SchemaControls
          schema={schema}
          schemas={schemas}
          search={table.tableSearch}
          onSchemaChange={setSchema}
          onSearchChange={table.setTableSearch}
        />
        <TableList table={table} tables={visibleTables} onOpen={onOpenTable} />
        <DefinitionList table={table} counts={counts} onOpen={onOpenDefinition} />
      </div>

      <div className="border-t p-1.5">
        <RailButton icon={SourceCodeIcon} label="New query" meta="⌘K" onClick={onNewQuery} />
      </div>
    </aside>
  );
}

function SchemaControls({
  schema,
  schemas,
  search,
  onSchemaChange,
  onSearchChange,
}: {
  schema: string;
  schemas: string[];
  search: string;
  onSchemaChange: (schema: string) => void;
  onSearchChange: (search: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-2.5 pb-1.5">
        <span className="font-mono text-[10px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
          Schema
        </span>
        <select
          value={schema}
          onChange={(event) => onSchemaChange(event.target.value)}
          className="max-w-28 bg-transparent font-mono text-[10px] text-muted-foreground outline-none"
          aria-label="Schema"
        >
          <option value="all">all</option>
          {schemas.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="relative mx-2 mb-2">
        <HugeiconsIcon
          icon={Search01Icon}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search tables…"
          className="h-7 pl-7 font-mono text-[11px]"
        />
      </div>
    </>
  );
}

function TableList({
  table,
  tables,
  onOpen,
}: {
  table: DataStudioController["table"];
  tables: DataStudioController["table"]["tables"];
  onOpen: (table: TableRef) => void;
}) {
  if (table.tablesQuery.isLoading) return <RailSkeleton />;
  if (table.tablesQuery.isError) {
    return <p className="px-3.5 py-1 text-[11px] text-destructive">Couldn&rsquo;t read schema.</p>;
  }
  if (tables.length === 0) {
    const message = table.tables.length === 0 ? "No tables yet." : "No matching tables.";
    return <p className="px-3.5 py-1 text-[11px] text-muted-foreground">{message}</p>;
  }
  return (
    <div className="px-1.5">
      {tables.map((item) => (
        <RailButton
          key={`${item.schema}.${item.name}`}
          active={isActiveTable(table, item)}
          icon={Table01Icon}
          label={item.name}
          meta={item.estimatedRows == null ? undefined : `~${compactCount(item.estimatedRows)}`}
          onClick={() => onOpen(item)}
        />
      ))}
    </div>
  );
}

function DefinitionList({
  table,
  counts,
  onOpen,
}: {
  table: DataStudioController["table"];
  counts: Record<DefinitionSection, number>;
  onOpen: (section: DefinitionSection) => void;
}) {
  return (
    <>
      <div className="px-2.5 pt-4 pb-1.5 font-mono text-[10px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
        Definitions
      </div>
      <div className="px-1.5">
        {definitionLabels.map((item) => (
          <RailButton
            key={item.id}
            active={
              table.mode === "table" &&
              table.tableView === "definitions" &&
              table.definitionsSection === item.id
            }
            icon={Key01Icon}
            label={item.label}
            meta={String(counts[item.id])}
            onClick={() => onOpen(item.id)}
          />
        ))}
      </div>
    </>
  );
}

function isActiveTable(table: DataStudioController["table"], item: TableRef): boolean {
  return (
    table.mode === "table" &&
    table.tableView !== "definitions" &&
    table.selected?.schema === item.schema &&
    table.selected.name === item.name
  );
}

function RailButton({
  icon,
  label,
  meta,
  active = false,
  onClick,
}: {
  icon: typeof PlusSignIcon;
  label: string;
  meta?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        active &&
          "bg-muted/70 font-medium text-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/65">{meta}</span>
      ) : null}
    </button>
  );
}

function RailSkeleton() {
  return (
    <div className="space-y-1 px-2 py-1">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="h-5 animate-pulse rounded-sm bg-muted/60" />
      ))}
    </div>
  );
}

const countFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function compactCount(value: number): string {
  return countFormat.format(value);
}
