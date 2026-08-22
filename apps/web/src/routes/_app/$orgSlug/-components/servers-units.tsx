/**
 * The systemd units a managed host is running, inside the per-server sheet.
 *
 * The collector (system-health/systemd.ts) and `server.units` landed without
 * a surface, so the data has been arriving and going nowhere. This is that
 * surface: what is running on the box, what has died, and what is eating the
 * machine — the question you ask before "is the container up", because a host
 * whose docker.service is dead has no containers to be up.
 *
 * Two things drive the layout. A healthy host reports 60–150 units, which is
 * far more than anyone scans by eye, so failures sort to the top and a filter
 * sits above the list rather than being a later addition. And every number
 * here is a REPORT, not a probe: when a host stops reporting the rows do not
 * become false, they become old, and they say so instead of quietly aging
 * into a lie.
 */
import { useMemo, useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import type { ServerId } from "@otterdeploy/shared/id";

import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc } from "@/shared/server/orpc";
import { humanizeSeconds } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

import { fmtBytes } from "./servers-health-pool";

type Unit = Awaited<ReturnType<typeof orpc.server.units.call>>[number];

/**
 * Sort weight per active state: anything an operator would act on first.
 * `failed` above the transitional states because a unit stuck activating is
 * still trying, and a failed one has stopped.
 */
const STATE_RANK: Record<Unit["activeState"], number> = {
  failed: 0,
  activating: 1,
  deactivating: 2,
  reloading: 3,
  active: 4,
  inactive: 5,
  unknown: 6,
};

/**
 * The dot's colour is the unit's ANSWER, not its severity to us: `inactive` is
 * muted rather than red because a socket-activated unit sitting dead is
 * working exactly as intended, and colouring it as a fault would train the
 * operator to ignore the colour.
 */
const STATE_DOT: Record<Unit["activeState"], string> = {
  failed: "bg-destructive",
  activating: "bg-warning",
  deactivating: "bg-warning",
  reloading: "bg-warning",
  active: "bg-success",
  inactive: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
};

/** Uptime since the unit's last activation. Null when the host never told us
 *  when that was, or when its clock puts it in the future — both are "we
 *  can't say", which is not the same as "just started". */
function since(iso: string | null): string | null {
  if (iso === null) return null;
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return seconds < 0 ? null : humanizeSeconds(seconds);
}

/** `docker.service` → `docker`. The suffix is the same on almost every row,
 *  so it costs width and carries nothing; the full name stays in the title. */
function shortName(unitName: string): string {
  return unitName.replace(/\.(service|socket|timer|mount|target|path|scope|slice)$/, "");
}

export function ServerUnits({ serverId }: { serverId: ServerId }) {
  const [query, setQuery] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);

  const units = useQuery({
    ...orpc.server.units.queryOptions({ input: { id: serverId } }),
    // Half the host's report cadence, matching the health collection: the row
    // can't be fresher than the report behind it, so polling faster only costs
    // requests.
    refetchInterval: 30_000,
  });

  // Memoized on `units.data` rather than written as `units.data ?? []` inline:
  // the fallback allocates a new array on every render, which would make the
  // sort below re-run on every keystroke against a list of 150.
  const all = useMemo(() => units.data ?? [], [units.data]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter((u) => (failedOnly ? u.activeState === "failed" : true))
      .filter((u) => (needle === "" ? true : u.unitName.toLowerCase().includes(needle)))
      .sort(
        (a, b) =>
          STATE_RANK[a.activeState] - STATE_RANK[b.activeState] ||
          a.unitName.localeCompare(b.unitName),
      );
  }, [all, query, failedOnly]);

  const failed = all.filter((u) => u.activeState === "failed").length;
  // The host reports every unit in one payload, so staleness is a property of
  // the report, not of individual units: if any row is stale they all are.
  const stale = all.length > 0 && all.every((u) => u.stale);

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          Services
        </span>
        {all.length > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {visible.length}/{all.length}
          </span>
        )}
      </div>

      {units.isPending ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      ) : all.length === 0 ? (
        // Not "no services" — a Linux host always has some. We have not been
        // told about them, which is a different fact and the useful one.
        <p className="text-[11.5px] text-muted-foreground">
          No unit report from this host yet. Units arrive with the health agent, on hosts
          running systemd.
        </p>
      ) : (
        <>
          {stale && (
            <p className="text-[11.5px] text-warning">
              This host stopped reporting. These are its last known units, not its current
              ones.
            </p>
          )}

          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter units…"
                aria-label="Filter units"
                className="h-7 pl-8 text-[12px]"
              />
            </div>
            {failed > 0 && (
              <button
                type="button"
                onClick={() => setFailedOnly((v) => !v)}
                aria-pressed={failedOnly}
                className={cn(
                  "h-7 shrink-0 rounded-md px-2 font-mono text-[11px] ring-1 transition-colors",
                  failedOnly
                    ? "bg-destructive/15 text-destructive ring-destructive/30"
                    : "text-muted-foreground ring-foreground/10 hover:text-foreground",
                )}
              >
                {failed} failed
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground">
              No unit matches &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60 rounded-md ring-1 ring-foreground/10">
              {visible.map((unit) => (
                <UnitRow key={unit.unitName} unit={unit} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UnitRow({ unit }: { unit: Unit }) {
  const uptime = unit.activeState === "active" ? since(unit.activeEnterAt) : null;
  // Only the facts this unit actually has. A host without memory accounting
  // reports null, and an em dash would read as "zero" rather than "unknown".
  const facts = [
    unit.cpuPct > 0 ? `${unit.cpuPct.toFixed(1)}%` : null,
    unit.memBytes === null ? null : fmtBytes(unit.memBytes),
    uptime === null ? null : `up ${uptime}`,
    unit.restartCount > 0 ? `${unit.restartCount}×` : null,
  ].filter((f) => f !== null);

  return (
    <div className="flex items-baseline gap-2 px-2.5 py-1.5" title={unit.unitName}>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", STATE_DOT[unit.activeState])}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
        {shortName(unit.unitName)}
      </span>
      {unit.activeState === "failed" ? (
        <Badge
          variant="outline"
          className="h-4 shrink-0 border-destructive/30 bg-destructive/10 px-1 font-mono text-[9.5px] font-medium text-destructive"
        >
          {unit.subState}
        </Badge>
      ) : (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {unit.subState}
        </span>
      )}
      {facts.length > 0 && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {facts.join(" · ")}
        </span>
      )}
    </div>
  );
}
