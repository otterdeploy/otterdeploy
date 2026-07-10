/** Filter toolbar for the runs table: project chips, kind, destination, search. */
import { Search01Icon } from "@hugeicons/core-free-icons";
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

import type { Destination } from "./data/destinations";

import { ALL_PROJECTS, type BackupKind, Segmented } from "./shared";

export function BackupsFilters({
  projects,
  projectCounts,
  projectFilter,
  onProjectFilter,
  kindFilter,
  onKindFilter,
  destFilter,
  onDestFilter,
  destinations,
  search,
  onSearch,
}: {
  projects: string[];
  projectCounts: Record<string, number>;
  projectFilter: string;
  onProjectFilter: (v: string) => void;
  kindFilter: "all" | BackupKind;
  onKindFilter: (v: "all" | BackupKind) => void;
  destFilter: string;
  onDestFilter: (v: string) => void;
  destinations: Destination[];
  search: string;
  onSearch: (v: string) => void;
}) {
  const allCount = Object.values(projectCounts).reduce((a, b) => a + b, 0);
  const destItems = [
    { label: "All destinations", value: "all" },
    ...destinations.map((d) => ({ label: d.name, value: d.id })),
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
        <ProjectFilterButton
          active={projectFilter === ALL_PROJECTS}
          onClick={() => onProjectFilter(ALL_PROJECTS)}
          label="All projects"
          count={allCount}
        />
        {projects.map((id) => (
          <ProjectFilterButton
            key={id}
            active={projectFilter === id}
            onClick={() => onProjectFilter(id)}
            label={id}
            count={projectCounts[id] ?? 0}
          />
        ))}
      </div>

      {/* No "Stack" chip: no stack engine exists, so it could never match. */}
      <Segmented
        value={kindFilter}
        onChange={onKindFilter}
        options={[
          { id: "all", label: "All" },
          { id: "database", label: "Database" },
          { id: "volume", label: "Volume" },
        ]}
      />

      <Select items={destItems} value={destFilter} onValueChange={(v) => onDestFilter(v ?? "all")}>
        <SelectTrigger size="sm" className="w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {destItems.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search source, host, id…"
          className="h-8 w-64 pl-8 font-mono text-xs"
        />
      </div>
    </div>
  );
}

function ProjectFilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
