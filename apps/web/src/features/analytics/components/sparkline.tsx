/**
 * Tiny inline area sparkline for the stat tiles: one polyline + gradient
 * fill, no axes, no tooltip: the tile's number IS the reading, the spark
 * only shows shape. Hand-rolled SVG: a chart library per tile is weight the
 * tiles don't need.
 */

const W = 120;
const H = 28;

export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return <div style={{ height: H }} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = W / (values.length - 1);
  const points = values.map((v, i) => {
    const x = Math.round(i * step * 100) / 100;
    // 2px headroom top and bottom so the stroke never clips.
    const y = Math.round((H - 2 - ((v - min) / span) * (H - 4)) * 100) / 100;
    return `${x},${y}`;
  });
  const line = points.join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <polygon points={area} fill="var(--primary)" opacity="0.12" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
