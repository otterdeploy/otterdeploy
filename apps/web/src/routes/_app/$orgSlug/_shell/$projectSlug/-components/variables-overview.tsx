import { useMemo, useState } from "react";

import {
  ArrowDown01Icon,
  Cancel01Icon,
  FilterIcon,
  Key01Icon,
  RemoveCircleIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";

import type { CellStatus, EnvironmentRef, EnvVarRow } from "./variables-types";

function cellStatus(rows: EnvVarRow[], key: string): CellStatus {
  const row = rows.find((r) => r.key === key);
  if (!row) return "missing";
  return row.value === "" ? "empty" : "set";
}

export function OverviewMatrix({
  envs,
  byEnv,
  allKeys,
}: {
  envs: EnvironmentRef[];
  byEnv: Map<string, EnvVarRow[]>;
  allKeys: string[];
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = allKeys.filter(
    (k) => !q || k.toLowerCase().includes(q.toLowerCase()),
  );

  // Count defined keys per env — every row counts (both `set` and
  // `empty`); only `missing` (no row) doesn't contribute.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const env of envs) {
      out.set(env.id, (byEnv.get(env.id) ?? []).length);
    }
    return out;
  }, [envs, byEnv]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered));
  };

  if (envs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-muted-foreground">
        This project has no environments. Create one to start adding variables.
      </div>
    );
  }

  const gridCols = `28px 1fr 28px repeat(${envs.length}, minmax(96px, 1fr))`;

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Project overview</h2>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5">
          <HugeiconsIcon icon={FilterIcon} className="size-3.5" />
          Filters
        </Button>
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search by secret or folder name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-72 pl-8"
          />
        </div>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Inject secrets via the{" "}
        <code className="font-mono text-foreground/80">otterdeploy</code> CLI,
        runtime API, or build-time env-injection. Switch to an environment tab to
        add or edit values.
      </p>

      <div className="overflow-hidden rounded-md border bg-card">
        <div
          className="grid items-center gap-2 border-b bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: gridCols }}
        >
          <Checkbox
            checked={selected.size > 0 && selected.size === filtered.length}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <span className="flex items-center gap-1">
            Name{" "}
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-50" />
          </span>
          <span />
          {envs.map((env) => (
            <span key={env.id} className="flex items-center gap-1.5 capitalize">
              {env.name || env.slug}
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {counts.get(env.id) ?? 0}
              </span>
            </span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {allKeys.length === 0
              ? "No variables defined yet. Open an environment to add one."
              : "No keys match this search."}
          </div>
        ) : (
          filtered.map((key) => (
            <div
              key={key}
              className="grid items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30"
              style={{ gridTemplateColumns: gridCols }}
            >
              <Checkbox
                checked={selected.has(key)}
                onCheckedChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                aria-label={`Select ${key}`}
              />
              <span className="flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={Key01Icon}
                  className="size-3 text-muted-foreground/70"
                />
                <span className="font-mono text-xs font-medium">{key}</span>
              </span>
              <span />
              {envs.map((env) => (
                <span key={env.id} className="flex items-center">
                  <StatusGlyph status={cellStatus(byEnv.get(env.id) ?? [], key)} />
                </span>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <HugeiconsIcon icon={Key01Icon} className="size-3" />
        <span>{filtered.length}</span>
        <div className="flex-1" />
        <span className="font-mono">
          1 – {filtered.length} of {filtered.length}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">Legend</span>
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="set" /> set with value
        </span>
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="empty" /> defined, empty
        </span>
        <span className="flex items-center gap-1.5">
          <StatusGlyph status="missing" /> not defined in this env
        </span>
      </div>
    </div>
  );
}

function StatusGlyph({ status }: { status: CellStatus }) {
  if (status === "set") {
    return (
      <HugeiconsIcon
        icon={Tick02Icon}
        className="size-3.5 text-emerald-500"
        aria-label="set"
      />
    );
  }
  if (status === "missing") {
    return (
      <HugeiconsIcon
        icon={Cancel01Icon}
        className="size-3.5 text-rose-500"
        aria-label="missing"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={RemoveCircleIcon}
      className="size-3 text-amber-500"
      aria-label="empty"
    />
  );
}
