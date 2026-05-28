import { useMemo, useState } from "react";

type Range = "1h" | "6h" | "24h" | "7d";
const RANGES: Range[] = ["1h", "6h", "24h", "7d"];

export function Metrics() {
  const [range, setRange] = useState<Range>("1h");
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <SectionH title="Metrics" sub={`Last ${range} · all services`} />
          <div style={{ flex: 1 }} />
          <div
            className="row gap-1"
            style={{
              background: "var(--bg-sunken)",
              padding: 2,
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  padding: "3px 10px",
                  fontSize: 12,
                  borderRadius: 4,
                  background: r === range ? "var(--bg-elev)" : "transparent",
                  color: r === range ? "var(--fg)" : "var(--fg-3)",
                  fontWeight: r === range ? 500 : 400,
                  cursor: "pointer",
                  boxShadow: r === range ? "var(--shadow-sm)" : "none",
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          <Chart title="CPU" unit="%" max={100} seed={3} band={[20, 75]} />
          <Chart title="Memory" unit="%" max={100} seed={7} band={[40, 70]} />
          <Chart title="Request rate" unit="rps" max={1500} seed={11} band={[800, 1300]} />
          <Chart title="P95 latency" unit="ms" max={500} seed={13} band={[60, 180]} />
        </div>
      </div>
    </div>
  );
}

function SectionH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>{title}</h3>
      {sub && (
        <span className="muted" style={{ fontSize: 12 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Chart({
  title,
  unit,
  max,
  seed,
  band,
}: {
  title: string;
  unit: string;
  max: number;
  seed: number;
  band: [number, number];
}) {
  const points = useMemo(() => {
    const pts: number[] = [];
    let v = (band[0] + band[1]) / 2;
    let s = seed;
    const rng = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < 80; i++) {
      v += (rng() - 0.5) * 30;
      v = Math.max(band[0] - 10, Math.min(band[1] + 10, v));
      pts.push(v);
    }
    return pts;
  }, [seed, band]);
  const W = 600,
    H = 140,
    P = 8;
  const pathD = points
    .map((p, i) => {
      const x = P + (i / (points.length - 1)) * (W - 2 * P);
      const y = P + (1 - p / max) * (H - 2 * P);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaD = pathD + ` L ${W - P} ${H - P} L ${P} ${H - P} Z`;
  const cur = Math.round(points[points.length - 1] ?? 0);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{title}</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
          {cur}
          <span className="muted" style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>
            {unit}
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: 140, display: "block" }}
        preserveAspectRatio="none"
      >
        <path d={areaD} fill="var(--bg-overlay)" />
        <path d={pathD} fill="none" stroke="var(--fg)" strokeWidth="1.4" />
      </svg>
    </div>
  );
}
