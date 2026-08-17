/**
 * Visitors by country: a real choropleth (pre-projected SVG paths, no mapping
 * library — see ../../../scripts/update-world-map.mjs), a donut, and the
 * ranked country list, all colored from ONE rank→accent ramp so a country is
 * the same shade in all three places.
 *
 * The ramp is by RANK, not by share: traffic is heavily skewed (one country
 * is usually most of it), so ramping on absolute share collapses the whole
 * long tail into a single shade. The span is fixed at RAMP_SPAN and rank is
 * clamped to it: the readable ranks get the whole ramp, and the tail — which
 * is all "barely any traffic" anyway — shares the faintest step.
 */

import { useMemo, useState } from "react";

import { Card } from "@/shared/components/ui/card";

import type { TopEntry } from "../analytics-model";

import { countryName, formatCount, formatShare } from "../analytics-model";
import countryPaths from "../country-paths.json";
import { CountryFlag } from "./country-flag";

const RAMP_SPAN = 12;
const DONUT_SLICES = 6;

/** rank → mix % of the accent into the card surface, 100% → 22%. A color-mix
 *  rather than opacity: opacity composites against whatever sits behind the
 *  path, which washes out on light surfaces; a mix is a solid paint. */
function fillFor(rank: number): string {
  const t = Math.min(rank, RAMP_SPAN) / RAMP_SPAN;
  const pct = Math.round(100 - t * 78);
  return `color-mix(in oklab, var(--primary) ${pct}%, var(--card))`;
}

interface HoverState {
  code: string;
  x: number;
  y: number;
}

export function VisitorMap({
  countries,
  visitorDays,
  geoAvailable,
}: {
  countries: readonly TopEntry[];
  visitorDays: number;
  geoAvailable: boolean;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const { rankOf, countOf, total } = useMemo(() => {
    const rankOf = new Map<string, number>();
    const countOf = new Map<string, number>();
    let total = 0;
    countries.forEach((entry, index) => {
      if (entry.key !== "other") rankOf.set(entry.key, index);
      countOf.set(entry.key, entry.count);
      total += entry.count;
    });
    return { rankOf, countOf, total };
  }, [countries]);

  const hovered =
    hover === null
      ? null
      : {
          code: hover.code,
          name: countryName(hover.code),
          count: countOf.get(hover.code) ?? 0,
        };

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Visitors by country</span>
          <span className="text-xs text-muted-foreground">
            {geoAvailable
              ? `${formatCount(total)} requests from ${countries.filter((c) => c.key !== "other").length} countries`
              : "GeoIP isn't configured on this install, so countries can't be resolved."}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-lg leading-none font-semibold tabular-nums">
            {formatCount(visitorDays)}
          </span>
          <span className="text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
            visitor-days
          </span>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ── Map ─────────────────────────────────────────────────────── */}
        <div className="relative flex items-center justify-center px-2 pb-2">
          <svg
            viewBox="0 12 360 150"
            // Height-capped: a full-width card would otherwise balloon to the
            // map's natural aspect and dwarf everything else on the page.
            className="h-auto max-h-80 w-full"
            role="img"
            aria-label="World map of visitor countries"
            onPointerLeave={() => setHover(null)}
          >
            {Object.entries(countryPaths.paths).map(([code, d]) => {
              const rank = rankOf.get(code);
              return (
                <path
                  key={code}
                  d={d}
                  fillRule="evenodd"
                  fill={rank === undefined ? "var(--muted)" : fillFor(rank)}
                  stroke="var(--border)"
                  strokeWidth={0.25}
                  className={rank === undefined ? undefined : "cursor-pointer"}
                  onPointerMove={
                    rank === undefined
                      ? undefined
                      : (e) => {
                          const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                          if (!box) return;
                          setHover({ code, x: e.clientX - box.left, y: e.clientY - box.top });
                        }
                  }
                />
              );
            })}
          </svg>
          {hovered && hover ? (
            <div
              className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: hover.x, top: hover.y - 8 }}
            >
              <CountryFlag code={hovered.code} />
              <span className="font-medium">{hovered.name}</span>
              <span className="font-mono text-muted-foreground tabular-nums">
                {formatCount(hovered.count)} · {formatShare(hovered.count, total)}
              </span>
            </div>
          ) : null}
        </div>

        {/* ── Donut + ranked list ─────────────────────────────────────── */}
        <div className="flex flex-col gap-2 px-4 pb-3 lg:pr-4 lg:pl-0">
          {countries.length === 0 ? (
            <p className="flex h-full min-h-32 items-center justify-center text-center text-xs text-muted-foreground">
              {geoAvailable
                ? "No visitor countries in this window."
                : "Countries appear here once GeoIP is configured."}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-4 pt-1">
                <CountryDonut countries={countries} total={total} />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Share of requests by country. The map shows where; the list shows how many.
                </p>
              </div>
              <ul className="max-h-56 overflow-y-auto">
                {countries.map((entry, index) => (
                  <li key={entry.key} className="flex items-center gap-2.5 rounded-sm px-1 py-1">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{
                        background: entry.key === "other" ? "var(--muted)" : fillFor(index),
                      }}
                    />
                    <CountryFlag code={entry.key} />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {entry.key === "other" ? "Other" : countryName(entry.key)}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {formatCount(entry.count)}
                    </span>
                    <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                      {formatShare(entry.count, total)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Donut of the top slices + a tail wedge. Exists alongside the map because a
 * choropleth's visual weight is LAND AREA: Russia looks huge at any share and
 * Singapore is invisible at 40%. Stroke-dasharray arcs on a circle: no chart
 * library needed for a static proportion ring.
 */
function CountryDonut({ countries, total }: { countries: readonly TopEntry[]; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const top = countries.slice(0, DONUT_SLICES).filter((entry) => entry.key !== "other");
  const tail = total - top.reduce((s, entry) => s + entry.count, 0);

  // Accumulate the running offset through reduce state (not a closed-over
  // `let`): render-scope callbacks must stay reassignment-free.
  const slices = top.reduce<{
    list: Array<{ key: string; fill: string; frac: number; offset: number }>;
    acc: number;
  }>(
    (state, entry, index) => {
      const frac = total > 0 ? entry.count / total : 0;
      state.list.push({ key: entry.key, fill: fillFor(index), frac, offset: state.acc });
      return { list: state.list, acc: state.acc + frac };
    },
    { list: [], acc: 0 },
  ).list;

  return (
    <svg viewBox="0 0 88 88" className="size-24 shrink-0" role="img" aria-label="Country share">
      {/* Tail ring underneath; slices draw over it. */}
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--muted)" strokeWidth="9" />
      {slices.map((slice) => (
        <circle
          key={slice.key}
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke={slice.fill}
          strokeWidth="9"
          // 2px surface gap between segments so shares read as discrete.
          strokeDasharray={`${Math.max(slice.frac * c - 2, 0.5)} ${c}`}
          strokeDashoffset={-slice.offset * c}
          transform="rotate(-90 44 44)"
        />
      ))}
      <text
        x="44"
        y="42"
        textAnchor="middle"
        className="fill-foreground font-mono text-[13px] font-semibold tabular-nums"
      >
        {formatCount(total)}
      </text>
      <text x="44" y="54" textAnchor="middle" className="fill-muted-foreground text-[7px]">
        requests{tail > 0 ? ` · ${formatShare(tail, total)} other` : ""}
      </text>
    </svg>
  );
}
