import type { ReactNode } from "react";

/** Faint grid washed by a primary glow, both driven off theme tokens via
 *  color-mix so the panel tracks light/dark. Mirrors the sign-in surface so
 *  the onboarding wizard reads as the same product. The grid fades toward a
 *  central focal point so it reads as atmosphere, not a flat table. */
const gridStyle = {
  backgroundImage:
    "linear-gradient(color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)," +
    "linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
  backgroundSize: "64px 64px",
  WebkitMaskImage: "radial-gradient(120% 90% at 50% 44%, #000 25%, transparent 74%)",
  maskImage: "radial-gradient(120% 90% at 50% 44%, #000 25%, transparent 74%)",
} as const;

const glowStyle = {
  background:
    "radial-gradient(42rem 34rem at 50% 40%, color-mix(in oklab, var(--sidebar-primary) 11%, transparent), transparent 66%)",
} as const;

/**
 * Full-screen branded shell for the first-run setup wizard. Shares the auth
 * surface's atmosphere — faint grid, primary glow, top-left wordmark, security
 * footer — but leaves the centered content (the stepped wizard card) to the
 * caller rather than wrapping it in a fixed single card.
 */
export function WizardShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={gridStyle} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={glowStyle} />

        <div className="absolute top-7 left-7 lg:top-10 lg:left-12">
          <Wordmark />
        </div>

        <div className="relative w-full max-w-2xl">{children}</div>
      </main>

      {/* ─── Security footer (full width, normal flow) ─── */}
      <footer className="flex items-center justify-between border-t border-border px-7 py-3.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground/70 lg:px-12">
        <span className="uppercase">Otterdeploy Setup</span>
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
