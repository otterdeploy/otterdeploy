import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

/** Faint grid washed by a primary glow, both driven off theme tokens via
 *  color-mix so the panel tracks light/dark. Mirrors the sign-in shell so the
 *  onboarding surface reads as the same product. The grid fades toward the
 *  lower-left focal point so it reads as atmosphere, not a flat table. */
const gridStyle = {
  backgroundImage:
    "linear-gradient(color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)," +
    "linear-gradient(90deg, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)",
  backgroundSize: "56px 56px",
  WebkitMaskImage: "radial-gradient(130% 100% at 50% 50%, #000 30%, transparent 78%)",
  maskImage: "radial-gradient(130% 100% at 50% 50%, #000 30%, transparent 78%)",
} as const;

const glowStyle = {
  background:
    "radial-gradient(48rem 42rem at 50% 22%, color-mix(in oklab, var(--sidebar-primary) 16%, transparent), transparent 68%)",
} as const;

/**
 * Centered onboarding shell. Shares the sign-in surface's branded atmosphere —
 * faint grid, primary glow, top-left wordmark and security footer — but keeps
 * the form card centered rather than split-screen.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-7 py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={gridStyle} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={glowStyle} />

        <div className="absolute top-7 left-7 lg:top-14 lg:left-16">
          <Wordmark />
        </div>

        <div className="relative flex w-full max-w-110 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">{children}</CardContent>
          </Card>
          {footer ? (
            <div className="text-center text-xs text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </main>

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
