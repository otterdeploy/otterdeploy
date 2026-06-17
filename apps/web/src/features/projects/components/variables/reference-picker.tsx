/**
 * Reference picker dropdown — the Railway-style "Add Reference" surface
 * for the env-var editor.
 *
 * Reads from `project.refs.list` and renders one row per available
 * `${{Source.KEY}}` token in the project. The user picks a row; we
 * return the token string to the caller, which inserts it at the
 * cursor in the associated value field.
 *
 * Two grouping signals:
 *   - `sourceKind` (database / service / project / environment) drives
 *     the brand icon on the left of each row
 *   - `sourceName` is shown as a small label on the right so the user
 *     can tell DATABASE_URL on "postgres-main" from DATABASE_URL on
 *     "postgres-replica"
 *
 * Filter input narrows by substring match against `key`, `sourceName`,
 * or the full token — same fuzzy intuition as Railway's picker.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

type RefSourceKind = "database" | "service" | "project" | "environment";

interface RefGroup {
  key: string;
  kind: RefSourceKind;
  engine: "postgres" | "redis" | "mariadb" | "mongodb" | null;
  /** Resource name, or "Shared variables" for project/environment scope. */
  label: string;
  /** Small qualifier under the label (e.g. "database", "service"). */
  sub: string;
  items: Array<{ key: string; token: string; isSecret: boolean }>;
}

export interface ReferencePickerProps {
  /** Accepts either a branded project id or the plain string the
   *  caller has on hand — branded types are launder via `as never` at
   *  the query-options call so both shapes work. */
  projectId: string;
  /** Hide the row whose token equals this — used when the picker is
   *  opened from a field whose value already IS one specific token. */
  excludeToken?: string | null;
  /** Called once the user clicks a row. Receives the token to insert. */
  onPick: (token: string) => void;
  /** Optional close-the-picker callback for parent UIs that render the
   *  picker as a popover/menu. */
  onClose?: () => void;
  className?: string;
}

const ENGINE_ICONS = {
  postgres: Postgresql,
  redis: Redis,
  mariadb: Mariadb,
  mongodb: Mongodb,
} as const;

function SourceIcon({
  kind,
  engine,
}: {
  kind: "database" | "service" | "project" | "environment";
  engine: "postgres" | "redis" | "mariadb" | "mongodb" | null;
}) {
  if (kind === "database" && engine && engine in ENGINE_ICONS) {
    const Icon = ENGINE_ICONS[engine];
    return <Icon className="size-4 shrink-0" />;
  }
  // Generic monospace `{ }` glyph for service / project / environment
  // sources — they share the same neutral treatment.
  return (
    <span className="font-mono text-[11px] text-muted-foreground shrink-0">
      {"{ }"}
    </span>
  );
}

export function ReferencePicker({
  projectId,
  excludeToken,
  onPick,
  onClose,
  className,
}: ReferencePickerProps) {
  const [query, setQuery] = useState("");

  const { data: refs = [], isLoading } = useQuery(
    orpc.project.refs.list.queryOptions({
      input: { projectId: projectId as never },
    }),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = excludeToken
      ? refs.filter((r) => r.token !== excludeToken)
      : refs;
    if (q.length === 0) return base;
    return base.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.sourceName.toLowerCase().includes(q) ||
        r.token.toLowerCase().includes(q),
    );
  }, [refs, excludeToken, query]);

  // Group by source so each row's owner is unambiguous: resource exports sit
  // under the resource's own name, shared project/environment vars under
  // "Shared variables". Databases first, then services, then shared.
  const groups = useMemo(() => {
    const order = { database: 0, service: 1, project: 2, environment: 3 };
    const map = new Map<string, RefGroup>();
    for (const r of filtered) {
      const groupKey = `${r.sourceKind}:${r.sourceName}`;
      const existing = map.get(groupKey);
      if (existing) existing.items.push(r);
      else
        map.set(groupKey, {
          key: groupKey,
          kind: r.sourceKind,
          engine: r.engine,
          label: r.sourceName,
          sub:
            r.sourceKind === "database"
              ? "database"
              : r.sourceKind === "service"
                ? "service"
                : "project · all environments",
          items: [r],
        });
    }
    return [...map.values()].sort(
      (a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label),
    );
  }, [filtered]);

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-md border bg-popover shadow-md",
        className,
      )}
    >
      <div className="border-b p-2">
        <input
          autoFocus
          type="text"
          placeholder="Filter Database, Service or Shared Variables"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose?.();
          }}
          className="h-7 w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            Loading references…
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {query
              ? "No references match your filter"
              : "No references defined yet in this project"}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="mb-1 last:mb-0">
              {/* Group header names the owner — a resource, or the shared
                  project/environment scope — so each token's origin is clear. */}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <SourceIcon kind={g.kind} engine={g.engine} />
                <span className="text-[11.5px] font-semibold text-foreground">
                  {g.label}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                  {g.sub}
                </span>
              </div>
              {g.items.map((r) => (
                <button
                  key={r.token}
                  type="button"
                  onClick={() => {
                    onPick(r.token);
                    onClose?.();
                  }}
                  className="flex w-full items-center gap-2 py-1.5 pl-9 pr-3 text-left hover:bg-accent/40"
                >
                  <span className="font-mono text-[11.5px]">{r.key}</span>
                  {r.isSecret && (
                    <span className="ml-auto text-[10px] text-muted-foreground/70">
                      secret
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
