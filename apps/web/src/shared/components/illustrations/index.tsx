/**
 * The app's illustration language.
 *
 * There are ~39 empty states in this app, so illustration has to be a small
 * set of reusable marks rather than a drawing per screen — bespoke art at that
 * count is how a design system rots.
 *
 * THE RULES, which are the product's rules and not a separate art direction:
 *
 *   - Geometric and schematic, never figurative. No characters, no blobs, no
 *     scenes. DESIGN.md names "generic AI-SaaS template" art as an explicit
 *     anti-reference, and `template-arch-diagram.tsx` already establishes that
 *     when this app draws, it draws diagrams.
 *   - Built from the product's own primitives — cards, nodes, edges, the
 *     slashed-zero mark — so a picture is a picture OF something on the screen
 *     rather than a decoration beside it.
 *   - `currentColor` throughout, so a mark inherits whatever text color its
 *     container sets and themes for free in both light and dark.
 *   - Decorative: `aria-hidden`, never the accessible name. The words under
 *     the mark carry the meaning, and the mark is never the only thing saying
 *     it — a screen reader loses nothing.
 *   - Motion modulates, never erases (see illustrations.css), and every
 *     animation stops under `prefers-reduced-motion`.
 *
 * All marks sit on {@link IllustrationPlate}, which draws the same grid the
 * 500 screen uses (packages/ui/src/error-screen.css), so the error page and
 * every empty state read as one family instead of unrelated pictures.
 */
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * The shared substrate: a faint square grid, radially masked so it dissolves
 * before it reaches an edge and never draws a hard line of its own.
 *
 * Sized in `currentColor` percentages rather than a token, so it works on any
 * surface — a card, the canvas, a dialog — without knowing which.
 */
export function IllustrationPlate({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("relative flex h-[168px] w-full items-center justify-center", className)}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklch, currentColor 11%, transparent) 1px, transparent 1px)," +
            "linear-gradient(90deg, color-mix(in oklch, currentColor 11%, transparent) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          maskImage: "radial-gradient(ellipse 62% 68% at 50% 50%, #000 20%, transparent 82%)",
          WebkitMaskImage: "radial-gradient(ellipse 62% 68% at 50% 50%, #000 20%, transparent 82%)",
        }}
      />
      <div className="relative text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * "Nothing in this collection."
 *
 * Two populated cards and one empty slot, drawn as the card grid the page
 * itself renders. The default mark: every collection surface in the app —
 * templates, channels, registries, projects, backups — shows cards, so this
 * needs no metaphor and no per-screen variant. The gap marches and breathes;
 * the filled cards' contents cross-fade on offset delays, so the shelf reads
 * as occupied while the hole stays the live thing.
 */
export function EmptyCollection() {
  return (
    <svg width="248" height="96" viewBox="0 0 248 96" fill="none" aria-hidden>
      <g stroke="currentColor" opacity="0.5">
        <rect x="0.5" y="12.5" width="70" height="70" rx="7" strokeWidth="1" />
        <rect
          x="88.5"
          y="4.5"
          width="70"
          height="86"
          rx="7"
          strokeWidth="1"
          strokeDasharray="4 4"
          className="ill-ants ill-breathe"
        />
        <rect x="177.5" y="12.5" width="70" height="70" rx="7" strokeWidth="1" />
      </g>
      {/* The filled cards carry content as hairlines; the empty slot carries
          none, which is the entire statement. */}
      <g stroke="currentColor" opacity="0.34" strokeWidth="1" strokeLinecap="round">
        <path d="M12 30h32M12 40h44M12 50h24" className="ill-sweep" />
        <path d="M189 30h32M189 40h44M189 50h24" className="ill-sweep ill-d2" />
      </g>
      <g fill="currentColor" opacity="0.42">
        <rect x="12" y="66" width="20" height="5" rx="2.5" />
        <rect x="189" y="66" width="20" height="5" rx="2.5" />
      </g>
    </svg>
  );
}
