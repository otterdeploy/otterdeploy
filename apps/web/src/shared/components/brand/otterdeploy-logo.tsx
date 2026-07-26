import type { SVGProps } from "react";

import {
  MARK_ARC,
  MARK_GLYPHS,
  MARK_RING,
  MARK_STROKE,
  MARK_VIEW_BOX,
  type MarkStatus,
} from "@/shared/components/brand/mark-geometry";
import { cn } from "@/shared/lib/utils";

/**
 * The otterdeploy mark and lockup.
 *
 * The mark is a slashed zero: the ring is the product's own `rounded-lg` node
 * silhouette, the slash is the mono detail DESIGN.md names by name. Geometry is
 * generated into `mark-geometry.ts` by `brand/scripts/build.sh`, so the in-app
 * mark, the shipped favicons, and the live favicon renderer are the same shape.
 *
 * The ring rides `currentColor` so the mark inherits whatever surface it lands
 * on; only the counter is chromatic.
 *
 * `status` swaps that counter to report system state. It changes SHAPE, not
 * just hue — at 16px, and for a colour-blind operator, colour alone says
 * nothing (DESIGN.md: never depend on colour alone).
 */

/** Per-status colour token. `deploying` stays on the brand accent — a deploy in
 *  flight is activity, not a warning. */
const STATUS_TOKEN: Record<MarkStatus, string> = {
  idle: "var(--brand-accent)",
  deploying: "var(--brand-accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--destructive)",
};

/** What a screen reader hears when the mark is carrying state. */
const STATUS_LABEL: Record<MarkStatus, string> = {
  idle: "otterdeploy",
  deploying: "otterdeploy — deploying",
  success: "otterdeploy — deployed",
  warning: "otterdeploy — needs attention",
  error: "otterdeploy — failed",
};

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  /** Rendered edge length in px. The grid is scale-free; 16 is the floor. */
  size?: number;
  /** Drops the accent so the mark renders in one colour (print, watermarks). */
  mono?: boolean;
  /** System state carried by the counter. Defaults to the plain slash. */
  status?: MarkStatus;
}

export function OtterdeployMark({
  size = 24,
  mono = false,
  status = "idle",
  className,
  ...props
}: MarkProps) {
  const color = mono ? "currentColor" : STATUS_TOKEN[status];
  const deploying = status === "deploying";

  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEW_BOX}
      fill="none"
      role="img"
      aria-label={STATUS_LABEL[status]}
      className={cn("shrink-0", className)}
      {...props}
    >
      {/* The ring is the brand and never changes shape. While deploying it dims
          to a track so the travelling arc reads as the only moving thing. */}
      <rect
        {...MARK_RING}
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        opacity={deploying ? 0.2 : 1}
      />

      {deploying && (
        <rect
          {...MARK_RING}
          stroke={color}
          strokeWidth={MARK_STROKE}
          strokeLinecap="round"
          pathLength={MARK_ARC.pathLength}
          strokeDasharray={MARK_ARC.dashArray}
          // `motion-reduce:` parks the arc instead of spinning it — the keyframes
          // and the parked offset both live in index.css (`.mark-arc`).
          className="mark-arc"
        />
      )}

      {MARK_GLYPHS[status].map((d) => (
        <path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={MARK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

interface LogoProps {
  /** Mark edge length in px; the wordmark is sized off it. */
  size?: number;
  /** Mark only, no wordmark — for collapsed sidebars and tight headers. */
  markOnly?: boolean;
  mono?: boolean;
  status?: MarkStatus;
  className?: string;
}

/**
 * Mark plus wordmark. The wordmark is live Geist rather than the outlined
 * `brand/logo/lockup.svg` — the app already loads the family, and live text
 * stays crisp at every zoom level and is selectable/searchable. The ratios
 * (0.66 of the mark, -0.025em) mirror the outlined lockup exactly.
 */
export function OtterdeployLogo({
  size = 24,
  markOnly = false,
  mono = false,
  status = "idle",
  className,
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center", className)} style={{ gap: size * 0.34 }}>
      {/* Hidden from AT only when it is pure decoration beside the wordmark.
          Once it carries a state, that state is the thing worth announcing. */}
      <OtterdeployMark
        size={size}
        mono={mono}
        status={status}
        aria-hidden={!markOnly && status === "idle"}
      />
      {!markOnly && (
        <span
          className="font-semibold text-foreground"
          style={{ fontSize: size * 0.66, letterSpacing: "-0.025em" }}
        >
          otterdeploy
        </span>
      )}
    </span>
  );
}
