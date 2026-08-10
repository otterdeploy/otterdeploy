import type { SVGProps } from "react";

import {
  MARK_ARC,
  MARK_GLYPHS,
  MARK_RING,
  MARK_STROKE,
  MARK_VIEW_BOX,
  type MarkStatus,
} from "./mark-geometry";

/**
 * The otterdeploy mark: a slashed zero. Port of the dashboard's component
 * (apps/web/src/shared/components/brand/otterdeploy-logo.tsx) reading the same
 * generated geometry, so the marketing site and the product can't drift.
 *
 * The ring rides `currentColor`; only the counter is chromatic. `status` swaps
 * that counter, changing SHAPE and not just hue: at 16px, and for a
 * colour-blind reader, colour alone says nothing.
 */

// `--od-accent` is the brighter cut of Signal Blue the landing page scopes for
// marks and dots; `--primary` is the button-surface cut and is the fallback
// anywhere the mark is used outside that scope.
const STATUS_TOKEN: Record<MarkStatus, string> = {
  idle: "var(--od-accent, var(--primary))",
  deploying: "var(--od-accent, var(--primary))",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--destructive)",
};

const STATUS_LABEL: Record<MarkStatus, string> = {
  idle: "otterdeploy",
  deploying: "otterdeploy, deploying",
  success: "otterdeploy, deployed",
  warning: "otterdeploy: needs attention",
  error: "otterdeploy, failed",
};

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  /** Rendered edge length in px. The grid is scale-free; 16 is the floor. */
  size?: number;
  /** System state carried by the counter. Defaults to the plain slash. */
  status?: MarkStatus;
  /** Renders the mark as meaningful content rather than decoration. */
  titled?: boolean;
}

export function OtterdeployMark({
  size = 24,
  status = "idle",
  titled = false,
  ...props
}: MarkProps) {
  const deploying = status === "deploying";
  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      width={size}
      height={size}
      fill="none"
      role={titled ? "img" : "presentation"}
      aria-label={titled ? STATUS_LABEL[status] : undefined}
      aria-hidden={titled ? undefined : true}
      {...props}
    >
      <rect
        x={MARK_RING.x}
        y={MARK_RING.y}
        width={MARK_RING.width}
        height={MARK_RING.height}
        rx={MARK_RING.rx}
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        // The travelling arc is the dashboard's "deploying" tell: one bright
        // segment orbiting a ring that never moves.
        {...(deploying
          ? {
              pathLength: MARK_ARC.pathLength,
              strokeDasharray: MARK_ARC.dashArray,
              strokeLinecap: "round" as const,
              className: "od-mark-arc",
            }
          : {})}
      />
      {MARK_GLYPHS[status].map((d) => (
        <path
          key={d}
          d={d}
          stroke={STATUS_TOKEN[status]}
          strokeWidth={MARK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** Mark + wordmark, as it appears in the site header and footer. */
export function Wordmark({ href = "/", size = 20 }: { href?: string; size?: number }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <OtterdeployMark size={size} />
      <span className="text-[0.95rem] font-semibold tracking-tight">otterdeploy</span>
    </a>
  );
}
