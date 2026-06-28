import type { ReactNode } from "react";

// Shared primitives for the README landing: the class-name joiner, the two CTA
// button styles, the wordmark, and the mono section kicker. Kept hairline/flat
// per the design tokens — colour comes from styles/app.css.

export const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

// ── Buttons ────────────────────────────────────────────────────────────────

const BTN =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4 [&_svg]:shrink-0";

export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={cx(BTN, "bg-primary text-primary-foreground hover:bg-primary/90")}>
      {children}
    </a>
  );
}

export function GhostButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cx(BTN, "border border-border bg-card text-foreground hover:bg-muted")}
    >
      {children}
    </a>
  );
}

// ── Wordmark ───────────────────────────────────────────────────────────────

export function Wordmark() {
  return (
    <a href="/" className="inline-flex items-baseline gap-1">
      <span className="text-base font-semibold tracking-tight text-foreground">otterdeploy</span>
      <span className="size-1.5 -translate-y-px rounded-full bg-primary" />
    </a>
  );
}

// ── Section heading (mono kicker, like a README h2) ────────────────────────

export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-16 font-mono text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
    >
      {children}
    </h2>
  );
}
