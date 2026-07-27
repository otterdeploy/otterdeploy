/**
 * The signature graphic: what goes in, what the platform is, what comes out.
 *
 * An isometric slab whose top face is the capability grid, wired to its
 * sources on the left and its live endpoints on the right, standing on the
 * three things it actually runs on.
 *
 * Two bits of geometry worth knowing before you move anything:
 *
 * 1. Everything sizes in `cqw` against `.od-iso`'s container, so the drawing
 *    scales with its column — no resize listener, no breakpoint table.
 * 2. The connector endpoints below sit ON the slab's projected edge. In the
 *    160 × 110 viewBox the projection measures: left vertex (23.8, 62.9),
 *    right (136.2, 62.9), top (80, 30.5), bottom (80, 95.3). Every trace below
 *    lands on a point interpolated along one of those edges. If you change the
 *    tile size, the padding or the rotation, re-measure — a connector that
 *    stops in mid-air is the tell that a diagram was drawn by eye.
 */

/** The nine cells of the slab's top face. Empty strings are negative space. */
const TILES: string[] = ["build", "", "edge", "data", "deploy", "logs", "", "previews", "backups"];

const SOURCES = ["git repo", "image", "compose"];
const OUTPUTS = ["https://", "tcp://"];
const FOUNDATION = ["docker swarm", "caddy", "postgres"];

/**
 * Circuit-trace connectors in a 160 × 110 viewBox laid over the stage. Each
 * path leaves a chip, runs orthogonally, and lands exactly on a point of the
 * slab's projected edge — a connector that stops in mid-air is the tell that a
 * diagram was drawn by eye.
 */
const IN_TRACES = [
  "M15.4 15 H24 V53.8 H39.5",
  "M15.4 24.5 H32 V46.7 H51.9",
  "M15.4 34.1 H44 V39.6 H64.3",
];
const OUT_TRACES = ["M98 40.9 H106 V19.4 H144.6", "M112.6 49.3 H120 V28.9 H147.1"];
/** One drop from the slab's bottom vertex to the row of things it stands on.
 *  Three drops would need to line up with three centred chips whose widths
 *  differ; one centred line says the same thing and can't fall out of step. */
const FOOT_TRACES = ["M80 95.3 V104"];

function Chip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-[0.4rem] border border-white/25 bg-white/[0.07] px-[1.6cqw] py-[0.7cqw] font-mono whitespace-nowrap text-white/85 backdrop-blur-[2px]"
      style={{ fontSize: "clamp(7px, 1.3cqw, 12px)" }}
    >
      {label}
    </span>
  );
}

export function PlatformDiagram() {
  return (
    <div className="od-iso relative w-full" aria-hidden>
      <div className="relative w-full" style={{ aspectRatio: "16 / 11" }}>
        {/* ── Connectors, behind everything ───────────────────────────── */}
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 160 110"
          fill="none"
          preserveAspectRatio="none"
        >
          <g stroke="oklch(0.82 0.1 225 / 0.5)" strokeWidth="0.45">
            {IN_TRACES.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g stroke="oklch(0.88 0.09 205 / 0.6)" strokeWidth="0.45">
            {OUT_TRACES.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <g stroke="oklch(0.7 0.05 240 / 0.4)" strokeWidth="0.45" strokeDasharray="1.4 2">
            {FOOT_TRACES.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>

        {/* ── Sources and endpoints ───────────────────────────────────── */}
        <div className="absolute top-[11%] left-0 flex flex-col gap-[2.4cqw]">
          {SOURCES.map((s) => (
            <Chip key={s} label={s} />
          ))}
        </div>
        <div className="absolute top-[15%] right-0 flex flex-col items-end gap-[2.4cqw]">
          {OUTPUTS.map((s) => (
            <Chip key={s} label={s} />
          ))}
        </div>

        {/* ── The slab ────────────────────────────────────────────────── */}
        <div
          className="absolute top-[16%] left-1/2 -translate-x-1/2"
          style={{ perspective: "1400px" }}
        >
          <div className="od-iso-stage relative">
            {/* Extruded side: a copy of the face pushed down, darker. */}
            <div
              className="absolute inset-0 rounded-[1.2cqw] bg-[oklch(0.3_0.13_266)]"
              style={{ transform: "translateZ(-2.4cqw)" }}
            />
            <div
              className="grid gap-[1cqw] rounded-[1.2cqw] border border-white/25 bg-[oklch(0.42_0.19_266)]/85 p-[1.2cqw]"
              style={{ gridTemplateColumns: "repeat(3, 15cqw)" }}
            >
              {TILES.map((tile, i) =>
                tile ? (
                  <span
                    key={tile}
                    className="grid h-[15cqw] place-items-center rounded-[0.8cqw] border border-white/35 bg-white/90"
                  >
                    {/* Counter-rotate the label out of the plane's Z spin, so
                        it reads left-to-right instead of running up the tile.
                        The X tilt stays — that foreshortening is the look. */}
                    <span
                      className="font-mono font-medium text-[#141412]"
                      style={{
                        transform: "rotateZ(45deg)",
                        fontSize: "clamp(6px, 1.35cqw, 12px)",
                      }}
                    >
                      {tile}
                    </span>
                  </span>
                ) : (
                  <span
                    key={`gap-${i}`}
                    className="h-[15cqw] rounded-[0.8cqw] border border-dashed border-white/25"
                  />
                ),
              )}
            </div>
          </div>
        </div>

        {/* ── Foundation ──────────────────────────────────────────────── */}
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 gap-[2cqw]">
          {FOUNDATION.map((f) => (
            <Chip key={f} label={f} />
          ))}
        </div>
      </div>
    </div>
  );
}
