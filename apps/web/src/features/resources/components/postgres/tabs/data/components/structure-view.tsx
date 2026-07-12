/**
 * Structure view — read-only column detail for the open table (the "Structure"
 * half of the Data/Structure toggle). One row per column: PK/FK glyph, name +
 * DEFAULT, type, nullability, and FK → referenced-column / UQ / PK badges.
 * Introspection runs through the same read-only query path as everything else.
 */

import { Key01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { ScrollArea } from "@/shared/components/ui/scroll-area";

import type { TableRef } from "../data/queries";
import type { StructureColumn } from "../data/structure";

import { useTableStructure } from "../data/use-database";
import { TypeLabel } from "./type-label";

export function StructureView({ resourceId, table }: { resourceId: string; table: TableRef }) {
  const { query, structure } = useTableStructure({ resourceId, table, enabled: true });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-1.5 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-muted/60" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="p-4 text-[12px] text-muted-foreground">
        Couldn&apos;t introspect the table&apos;s structure.
      </p>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-4">
        <div className="max-w-3xl overflow-hidden rounded-lg ring-1 ring-foreground/10">
          {structure.map((col, i) => (
            <StructureRow key={col.name} col={col} first={i === 0} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function StructureRow({ col, first }: { col: StructureColumn; first: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3.5 py-2 text-[12px] ${first ? "" : "border-t"}`}>
      {/* Key / link glyph gutter */}
      <span className="grid w-4 shrink-0 place-items-center">
        {col.isPrimaryKey ? (
          <HugeiconsIcon
            icon={Key01Icon}
            strokeWidth={2}
            className="size-3 text-amber-600 dark:text-amber-500"
          />
        ) : col.fkRef ? (
          <HugeiconsIcon
            icon={Link01Icon}
            strokeWidth={2}
            className="size-3 text-muted-foreground"
          />
        ) : null}
      </span>

      <div className="flex min-w-44 flex-col gap-0">
        <span className="font-mono font-medium">{col.name}</span>
        {col.default !== null ? (
          <span
            className="truncate font-mono text-[10px] text-muted-foreground/70"
            title={`DEFAULT ${col.default}`}
          >
            DEFAULT {col.default}
          </span>
        ) : null}
      </div>

      <TypeLabel type={col.displayType} className="min-w-20 text-[11px]" />

      <span className="font-mono text-[11px] text-muted-foreground">
        {col.nullable ? "nullable" : "not null"}
      </span>

      <div className="flex-1" />

      {col.fkRef ? (
        <Badge variant="outline" className="gap-1 font-mono text-[10px] font-normal">
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-2.5" />
          {"→ "}
          {col.fkRef.schema === "public"
            ? `${col.fkRef.table}.${col.fkRef.column}`
            : `${col.fkRef.schema}.${col.fkRef.table}.${col.fkRef.column}`}
        </Badge>
      ) : null}
      {col.isUnique ? (
        <Badge variant="outline" className="font-mono text-[10px] font-normal">
          UQ
        </Badge>
      ) : null}
      {col.isPrimaryKey ? (
        <Badge
          variant="outline"
          className="border-amber-600/30 font-mono text-[10px] font-normal text-amber-600 dark:text-amber-500"
        >
          PK
        </Badge>
      ) : null}
    </div>
  );
}
