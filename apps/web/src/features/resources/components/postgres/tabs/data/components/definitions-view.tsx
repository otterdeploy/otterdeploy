/**
 * Definitions: the schema objects that are not tables.
 *
 * Indexes, constraints and enums, in one read-only view. Conar has this as a
 * whole tab and it earns it — these are the things you go looking for when a
 * query is slow or a write is refused, and the alternative is typing
 * `\d+ orders` into a console you may not have open.
 *
 * Deliberately not per-table: they arrive whole-database in one call, so
 * filtering is instant and a section can be scanned across every table at once.
 * "Which unused index is costing me writes" is a question about the database,
 * not about a table.
 */
import { useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import type { WorkbenchTarget } from "../data/target";

import { useDefinitions } from "../data/use-database";
import { ConstraintTable, EnumTable, IndexTable, Note } from "./definitions-tables";

export type DefinitionSection = "indexes" | "constraints" | "enums";

const SECTIONS: ReadonlyArray<{ id: DefinitionSection; label: string }> = [
  { id: "indexes", label: "Indexes" },
  { id: "constraints", label: "Constraints" },
  { id: "enums", label: "Enums" },
];

export function DefinitionsView({
  target,
  section,
  onSectionChange,
}: {
  target: WorkbenchTarget;
  section: DefinitionSection;
  onSectionChange: (section: DefinitionSection) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useDefinitions(target);

  const needle = search.trim().toLowerCase();
  const counts = {
    indexes: data?.indexes.length ?? 0,
    constraints: data?.constraints.length ?? 0,
    enums: data?.enums.length ?? 0,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSectionChange(s.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors",
              s.id === section
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {s.label}
            <span className="font-mono text-[10px] opacity-60">{counts[s.id]}</span>
          </button>
        ))}
        <span className="flex-1" />
        <div className="relative w-56">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or table…"
            className="h-7 pl-7 text-[12px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <SectionBody
          section={section}
          needle={needle}
          data={data}
          isLoading={isLoading}
          isError={isError}
        />
      </div>
    </div>
  );
}

type Definitions = ReturnType<typeof useDefinitions>["data"];

function SectionBody({
  section,
  needle,
  data,
  isLoading,
  isError,
}: {
  section: DefinitionSection;
  needle: string;
  data: Definitions;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <Note>Loading…</Note>;
  if (isError) return <Note>Couldn&rsquo;t read the database&rsquo;s definitions.</Note>;
  if (section === "indexes") return <IndexTable rows={data?.indexes ?? []} needle={needle} />;
  if (section === "constraints") {
    return <ConstraintTable rows={data?.constraints ?? []} needle={needle} />;
  }
  return <EnumTable rows={data?.enums ?? []} needle={needle} />;
}
