import { GithubIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { GITHUB_URL, GRID_CELLS, PANEL_LINKS, SATELLITE_NODES } from "./content";
import { cx, GhostButton, PrimaryButton, Wordmark } from "./readme-landing-primitives";

// ── Isometric service graph (panel visual, ported from the old hero) ───────
// The 3×3 grid of service "boxes" (web / api / db / …) plus satellite nodes
// connected to the cluster. Uniformly scaled by S so the geometry — and the
// connector lines — stay aligned. Static (no entrance animation) to keep SSR
// hydration trivial; the panel's overflow-hidden clips any edge bleed.
const S = 0.7;

function PanelGraph({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("relative", className)} style={{ height: 240 }}>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative" style={{ width: 380, height: 240 }}>
          {/* connector lines from cluster centre to each satellite */}
          <svg className="absolute inset-0 size-full" style={{ zIndex: 0 }}>
            {SATELLITE_NODES.map((node) => (
              <line
                key={node.label}
                x1="50%"
                y1="50%"
                x2={`calc(50% + ${(node.x + 28) * S}px)`}
                y2={`calc(50% + ${(node.y + 12) * S}px)`}
                stroke="var(--primary)"
                strokeWidth="1"
                strokeOpacity={0.35}
              />
            ))}
          </svg>

          {/* isometric grid of service boxes */}
          <div
            className="absolute top-1/2 left-1/2"
            style={{
              transform: "translate(-50%, -50%) rotateX(55deg) rotateZ(-45deg)",
              transformStyle: "preserve-3d",
            }}
          >
            <div
              className="grid grid-cols-3"
              style={{ width: 252 * S, height: 252 * S, gap: 2.5 * S }}
            >
              {GRID_CELLS.map((label) => (
                <div
                  key={label}
                  className="flex items-center justify-center rounded-md border border-border bg-card font-mono"
                  style={{ width: 78 * S, height: 78 * S }}
                >
                  <span className="text-[9px] font-medium text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* satellite nodes */}
          {SATELLITE_NODES.map((node) => (
            <div
              key={node.label}
              className="absolute rounded-md border bg-card px-2 py-1 font-mono"
              style={{
                left: `calc(50% + ${node.x * S}px)`,
                top: `calc(50% + ${node.y * S}px)`,
                borderColor: "color-mix(in oklab, var(--primary) 40%, transparent)",
              }}
            >
              <span className="text-[9px] font-medium text-primary">{node.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Left brand panel ───────────────────────────────────────────────────────

export function BrandPanel() {
  return (
    <aside className="relative flex min-h-[78vh] flex-col justify-between overflow-hidden border-border bg-background px-7 py-9 lg:fixed lg:inset-y-0 lg:left-0 lg:min-h-screen lg:w-[40%] lg:border-r lg:px-12 lg:py-12 xl:w-[38%]">
      {/* faint dot-grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.6]"
        style={{
          backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 80% 60% at 30% 40%, #000 20%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 30% 40%, #000 20%, transparent 75%)",
        }}
      />

      <div className="relative">
        <Wordmark />
      </div>

      <div className="relative max-w-md">
        <PanelGraph className="mb-9 hidden sm:block" />
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          Self-hostable · open platform
        </span>
        <h1
          className="mt-6 font-semibold tracking-tight text-balance text-foreground"
          style={{
            fontSize: "clamp(2.1rem, 4.4vw, 3.1rem)",
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
          }}
        >
          Deploy anything, <span className="text-primary">on your own infra.</span>
        </h1>
        <p className="mt-5 max-w-sm text-[0.95rem] leading-relaxed text-muted-foreground">
          A self-hostable deployment platform. Ship apps, databases, and services behind a Caddy
          edge — with live logs, metrics, and access control. The control of self-hosting, the
          ergonomics of a PaaS.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <PrimaryButton href="/docs">Get started</PrimaryButton>
          <GhostButton href={GITHUB_URL}>
            <HugeiconsIcon icon={StarIcon} className="size-4" />
            Star on GitHub
          </GhostButton>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {PANEL_LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="transition-colors hover:text-foreground"
          >
            {l.label}
          </a>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={GithubIcon} className="size-4" />
          </a>
        </span>
      </div>
    </aside>
  );
}
