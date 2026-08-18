/**
 * Filter bar + predicates for the Raw Docker containers tab
 * (docker-table-containers.tsx): a text search over name/image/port/id and
 * mutually-exclusive state chips (Running / Healthy / Exited) whose counts
 * always describe the full, unfiltered list.
 */
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FilterPill } from "./servers-parts";

/** Local row type: mirrors the docker contract output shape. */
export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string[];
  createdAt: number;
  managed: boolean;
}

export type StateFilter = "running" | "healthy" | "exited" | null;

export function matchesStateFilter(c: Container, filter: StateFilter): boolean {
  switch (filter) {
    case null:
      return true;
    case "running":
      return c.state.toLowerCase() === "running";
    case "healthy":
      return /\(healthy\)/i.test(c.status);
    case "exited": {
      const s = c.state.toLowerCase();
      return s === "exited" || s === "dead";
    }
  }
}

export function matchesSearch(c: Container, needle: string): boolean {
  if (!needle) return true;
  return (
    c.name.toLowerCase().includes(needle) ||
    c.image.toLowerCase().includes(needle) ||
    c.id.startsWith(needle) ||
    c.ports.some((p) => p.toLowerCase().includes(needle))
  );
}

export function ContainersFilterBar({
  all,
  query,
  onQuery,
  filter,
  onFilter,
}: {
  all: Container[];
  query: string;
  onQuery: (value: string) => void;
  filter: StateFilter;
  onFilter: (next: StateFilter) => void;
}) {
  const chips: Array<[Exclude<StateFilter, null>, string]> = [
    ["running", "Running"],
    ["healthy", "Healthy"],
    ["exited", "Exited"],
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-72">
        <HugeiconsIcon
          icon={Search01Icon}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60"
        />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Filter containers"
          placeholder="Filter by name, image, port…"
          className="h-8 w-full rounded-lg border bg-transparent pl-8 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-foreground/20"
        />
      </div>
      {chips.map(([key, label]) => (
        <FilterPill
          key={key}
          active={filter === key}
          label={label}
          count={all.filter((c) => matchesStateFilter(c, key)).length}
          onClick={() => onFilter(filter === key ? null : key)}
        />
      ))}
      <span className="ml-auto font-mono text-[11.5px] text-muted-foreground tabular-nums">
        {all.length} container{all.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}
