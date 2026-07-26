import { Nextjs } from "@/components/brand/svgs/nextjs";
import { Postgresql } from "@/components/brand/svgs/postgresql";

import { cx, Mono } from "./primitives";
import { ResourceCard } from "./resource-card";

/**
 * The project canvas: the dashboard's own resource nodes on the dashboard's
 * own dot grid.
 *
 * Two cards at near-full fidelity beat four shrunk into thumbnails — the point
 * of this panel is that a node carries real information (framework, deployed
 * commit, mounts, live status), and that only lands if you can read it. The
 * postgres card wears the comet border so the page shows the product's
 * signature pending state, not just its resting one.
 */

/**
 * The card's real width in the product. The whole group scales by one factor
 * so the 44px brand tiles and the 18px names keep their true proportions —
 * `--s` steps down on narrow columns rather than letting a card run off the
 * canvas, and `--x` moves the second card in with it so the diagonal holds.
 */
const CARD_W = 368;
const FIT = "[--s:0.56] [--x:26px] sm:[--s:0.72] sm:[--x:60px] lg:[--s:0.8] lg:[--x:86px]";

export function ProjectVisual() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Mono className="text-foreground">storefront</Mono>
        <Mono className="ml-auto text-muted-foreground">4 resources</Mono>
      </div>

      <div
        className={cx(
          FIT,
          "relative h-[20rem] overflow-hidden sm:h-[25.5rem] lg:h-[28.5rem]",
        )}
      >
        {/* The canvas grid, as React Flow draws it in the product. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(circle, var(--border) 1.1px, transparent 1.1px)",
            backgroundSize: "18px 18px",
          }}
        />

        <div
          className="absolute origin-top-left"
          style={{ width: CARD_W, left: 16, top: 18, transform: "scale(var(--s))" }}
        >
          <ResourceCard
            name="web"
            kind="Service"
            status="running"
            logo={Nextjs}
            description="Storefront and checkout. Built from the main branch on every push."
            tech="Next.js · Railpack"
            git={{ commit: "a3f91c2", message: "feat: checkout redesign" }}
          />
        </div>

        <div
          className="absolute origin-top-left top-[10.5rem] sm:top-[13rem] lg:top-[14.5rem]"
          style={{ width: CARD_W, left: "var(--x)", transform: "scale(var(--s))" }}
        >
          <ResourceCard
            name="postgres"
            kind="Database"
            pending="create"
            logo={Postgresql}
            description="Primary datastore. Nightly encrypted backups to object storage."
            tech="PostgreSQL 17"
            mounts={[{ name: "pgdata", mount: "/var/lib/postgresql/data", size: "4.2 GB" }]}
          />
        </div>
      </div>
    </div>
  );
}
