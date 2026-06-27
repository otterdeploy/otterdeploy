import type { IconSvgElement } from "@hugeicons/react";

import type { ReactNode } from "react";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** Faint grid washed by a primary glow, both driven off theme tokens via
 *  color-mix so the panel tracks light/dark instead of hard-coding the dark
 *  palette. The grid is masked to fade out away from the lower-left focal
 *  point so it reads as atmosphere, not a flat table. */
const gridStyle = {
  backgroundImage:
    "linear-gradient(color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)," +
    "linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
  backgroundSize: "56px 56px",
  WebkitMaskImage: "radial-gradient(130% 100% at 12% 64%, #000 28%, transparent 82%)",
  maskImage: "radial-gradient(130% 100% at 12% 64%, #000 28%, transparent 82%)",
} as const;

const glowStyle = {
  background:
    "radial-gradient(48rem 42rem at 8% 72%, color-mix(in oklab, var(--sidebar-primary) 16%, transparent), transparent 68%)",
} as const;

const DEFAULT_FEATURES = [
  "Push to git — we build and ship",
  "Zero-downtime rolling deploys",
  "Logs, metrics & tracing built in",
];

export interface AuthPill {
  icon: IconSvgElement;
  label: string;
  value: string;
}

/**
 * Split-screen auth shell: a branded marketing panel on the left, the form
 * slot on the right, and a full-width security footer underneath both. Shared
 * by sign-in, sign-up, password reset and invitation acceptance so every auth
 * surface matches.
 */
export function AuthLayout({
  eyebrow,
  headline,
  pill,
  features = DEFAULT_FEATURES,
  children,
}: {
  eyebrow: string;
  headline: ReactNode;
  /** Optional mono pill (e.g. the protected origin on the access wall). */
  pill?: AuthPill;
  /** Trust/feature bullets under the headline. Pass `[]` to hide. */
  features?: string[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <div className="flex flex-1">
        {/* ─── Brand panel ─── */}
        <aside className="relative hidden flex-1 flex-col justify-center overflow-hidden border-r border-border p-12 lg:flex lg:p-16">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={gridStyle} />
          <div aria-hidden className="pointer-events-none absolute inset-0" style={glowStyle} />

          <div className="absolute top-12 left-12 lg:top-14 lg:left-16">
            <Wordmark />
          </div>

          <div className="relative max-w-xl">
            <p className="mb-5 font-mono text-[11px] tracking-[0.18em] text-sidebar-primary/80 uppercase">
              {eyebrow}
            </p>
            <h1 className="text-[clamp(2.25rem,2.8vw,3rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-foreground">
              {headline}
            </h1>

            {pill ? (
              <div className="mt-9">
                <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                  {pill.label}
                </div>
                <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-[13px] text-foreground backdrop-blur-sm">
                  <HugeiconsIcon
                    icon={pill.icon}
                    strokeWidth={2}
                    className="size-4 shrink-0 text-sidebar-primary"
                  />
                  {pill.value}
                </div>
              </div>
            ) : null}

            {features.length > 0 ? (
              <ul className="mt-10 space-y-3">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-foreground/75">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sidebar-primary/12 text-sidebar-primary ring-1 ring-sidebar-primary/25 ring-inset">
                      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-3" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </aside>

        {/* ─── Form panel ─── */}
        <main className="flex w-full flex-col justify-center px-7 py-14 lg:w-120 lg:flex-none lg:px-16">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </main>
      </div>

      {/* ─── Security footer (full width, normal flow) ─── */}
      <footer className="flex items-center justify-between border-t border-border px-7 py-3.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground/70 lg:px-16">
        <span className="uppercase">Otterdeploy Authentication</span>
        <span className="flex items-center gap-2">
          <span className="rounded border border-border px-1.5 py-0.5 text-[9px] tracking-[0.08em]">
            TLS 1.3
          </span>
          <span className="hidden uppercase sm:inline">secure channel</span>
        </span>
      </footer>
    </div>
  );
}

/** The "os" tile + product name, mirroring the app header's brand mark. */
function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-md bg-foreground text-[11px] font-semibold text-background lowercase">
        os
      </span>
      <span className="text-sm font-semibold tracking-[-0.02em] text-foreground">otterdeploy</span>
    </div>
  );
}
