/**
 * The Locations card's map mode: the pre-projected world SVG restyled to the
 * grey ramp — visitor share is magnitude, and magnitude on this surface is
 * ink, not the accent. Rank-ramped like the edge-plane map (traffic is
 * skewed; an absolute ramp collapses the long tail into one shade).
 */

import { useState } from "react";

import { CountryFlag } from "@/features/analytics/components/country-flag";

import { countryName, formatCount, formatShare } from "../../analytics-model";
import countryPaths from "../../country-paths.json";

const RAMP_SPAN = 12;

/** rank → % of the ink mixed into the card surface, 55% → 8%. Ink, never the
 *  accent: a map is data, and single-variable data stays monochrome. */
function fillFor(rank: number): string {
  const t = Math.min(rank, RAMP_SPAN) / RAMP_SPAN;
  const pct = Math.round(55 - t * 47);
  return `color-mix(in oklab, var(--foreground) ${pct}%, var(--card))`;
}

interface HoverState {
  code: string;
  x: number;
  y: number;
}

export function LocationsMap({
  rows,
  total,
}: {
  rows: ReadonlyArray<{ key: string; visitors: number }>;
  total: number;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const rankOf = new Map<string, number>();
  const countOf = new Map<string, number>();
  rows.forEach((row, index) => {
    rankOf.set(row.key, index);
    countOf.set(row.key, row.visitors);
  });

  const hovered =
    hover === null
      ? null
      : { code: hover.code, name: countryName(hover.code), count: countOf.get(hover.code) ?? 0 };

  return (
    <div className="relative flex flex-1 items-center justify-center">
      <svg
        viewBox="0 12 360 150"
        className="h-auto max-h-full w-full"
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
  );
}
