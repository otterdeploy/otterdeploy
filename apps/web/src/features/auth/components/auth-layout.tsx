import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { AuthHero } from "@/features/auth/components/auth-hero";
import { OtterdeployLogo } from "@/shared/components/brand/otterdeploy-logo";

/** Atmospheric haze sitting on the field's horizon, so the far dots dissolve
 *  into light rather than into flat panel. Driven off theme tokens via
 *  color-mix, so it tracks light/dark instead of hard-coding the dark palette. */
const glowStyle = {
  background:
    "radial-gradient(60rem 20rem at 50% 64%, color-mix(in oklab, var(--sidebar-primary) 9%, transparent), transparent 76%)",
} as const;

/** The scene is an edge-to-edge canvas; this mask lets it dissolve into the
 *  panel edges instead of ending at a hard rectangle against the form divider. */
const heroMaskStyle = {
  WebkitMaskImage: "radial-gradient(112% 88% at 50% 92%, #000 38%, transparent 90%)",
  maskImage: "radial-gradient(112% 88% at 50% 92%, #000 38%, transparent 90%)",
} as const;

/** Contrast floor under the copy block, which sits above the horizon. */
const scrimStyle = {
  background:
    "linear-gradient(to bottom, var(--background) 26%, color-mix(in oklab, var(--background) 55%, transparent) 46%, transparent 64%)",
} as const;

/** Same three layers, retuned for the short mobile/tablet band where the copy
 *  sits over the field's foreground rather than above its horizon. */
const bandGlowStyle = {
  background:
    "radial-gradient(30rem 12rem at 50% 46%, color-mix(in oklab, var(--sidebar-primary) 11%, transparent), transparent 78%)",
} as const;

const bandMaskStyle = {
  WebkitMaskImage: "linear-gradient(to bottom, transparent 2%, #000 26%)",
  maskImage: "linear-gradient(to bottom, transparent 2%, #000 26%)",
} as const;

const bandScrimStyle = {
  background:
    "linear-gradient(to top, var(--background) 14%, color-mix(in oklab, var(--background) 62%, transparent) 42%, transparent 76%)",
} as const;

/**
 * Split-screen auth shell: a brand panel carrying the hero scene, the form slot
 * beside it, and a full-width environment footer underneath both. Below `lg`
 * the panel becomes a brand band stacked above the form.
 *
 * The panel copy is deliberately two elements — a headline and one sentence.
 * The earlier kicker / metric-pill / icon-bullet stack was the generic SaaS
 * scaffold PRODUCT.md lists as an anti-reference, and it competed with the
 * scene instead of framing it.
 */
export function AuthLayout({
  headline,
  subhead,
  children,
}: {
  headline: ReactNode;
  /** One plain sentence under the headline. No bullets, no icons. */
  subhead?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* ─── Brand band (mobile / tablet) ─── */}
        <section className="relative flex h-[42svh] max-h-112 min-h-64 shrink-0 flex-col justify-end overflow-hidden border-b border-border px-7 pb-8 lg:hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={bandGlowStyle} />
          <div aria-hidden className="pointer-events-none absolute inset-0" style={bandMaskStyle}>
            <AuthHero layout="band" />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={bandScrimStyle}
          />

          <div className="absolute top-7 left-7">
            <Wordmark />
          </div>

          <div className="relative">
            <h1 className="text-[1.75rem] leading-[1.08] font-semibold tracking-[-0.038em] text-balance text-foreground">
              {headline}
            </h1>
            {subhead ? (
              <p className="mt-2.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                {subhead}
              </p>
            ) : null}
          </div>
        </section>

        {/* ─── Brand panel (desktop) ─── */}
        <aside className="relative hidden flex-1 flex-col overflow-hidden border-r border-border p-12 lg:flex lg:p-16">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={glowStyle} />
          <div aria-hidden className="pointer-events-none absolute inset-0" style={heroMaskStyle}>
            <AuthHero />
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-0" style={scrimStyle} />

          <div className="relative">
            <Wordmark />
          </div>

          {/* Copy is anchored under the wordmark rather than centred: the scene
              puts its horizon just below this block, so the field owns the
              bottom of the panel at every panel height. */}
          <div className="relative mt-[9vh] max-w-md">
            <h1 className="text-[2.75rem] leading-[1.04] font-semibold tracking-[-0.042em] text-balance text-foreground">
              {headline}
            </h1>
            {subhead ? (
              <p className="mt-6 max-w-[34ch] text-[15px] leading-[1.6] text-muted-foreground">
                {subhead}
              </p>
            ) : null}
          </div>
        </aside>

        {/* ─── Form panel ─── */}
        <main className="flex w-full flex-col justify-center px-7 py-14 lg:w-120 lg:flex-none lg:px-16">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </main>
      </div>

      {/* ─── Environment footer (full width, normal flow) ─── */}
      <footer className="flex items-center justify-between border-t border-border px-7 py-3.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground/70 lg:px-16">
        <span className="uppercase">{t("auth.layoutFooter")}</span>
        <ConnectionBadge />
      </footer>
    </div>
  );
}

/**
 * Reports the connection this page actually loaded over, instead of a
 * decorative "TLS 1.3 / SECURE CHANNEL" claim that was shown even over plain
 * `http://localhost`. This is a client-only SPA (no SSR), so `window` is
 * always available at render.
 */
function ConnectionBadge() {
  const secure = window.location.protocol === "https:";
  return (
    <span className="flex items-center gap-2">
      <span className="rounded border border-border px-1.5 py-0.5 text-[9px] tracking-[0.08em] uppercase">
        {secure ? "HTTPS" : "HTTP · DEV"}
      </span>
      <span className="hidden sm:inline">{window.location.host}</span>
    </span>
  );
}

/** Mark + product name, mirroring the app header's brand mark. */
function Wordmark() {
  return <OtterdeployLogo size={26} />;
}
