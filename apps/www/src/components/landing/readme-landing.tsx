import {
  Copy01Icon,
  GithubIcon,
  Moon02Icon,
  StarIcon,
  Sun03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  BUILT_ON,
  DEPLOY_LINES,
  FEATURE_CELLS,
  GITHUB_URL,
  GRID_CELLS,
  INSTALL_CMD,
  PANEL_LINKS,
  README_TABS,
  SATELLITE_NODES,
} from "./content";
import type { TerminalLine } from "./content";

// ───────────────────────────────────────────────────────────────────────────
// Better-Auth-style "README" landing: a fixed left brand panel and a right
// column that scrolls and reads like a project README. All colour comes from
// the shared design tokens (styles/app.css) — light by default, with the
// Fumadocs/next-themes `dark` toggle re-scoping them. The Signal Blue accent is
// kept for the primary CTA, links, and small marks (≤10% of any screen).
// ───────────────────────────────────────────────────────────────────────────

const cx = (...parts: Array<string | false | undefined>) =>
  parts.filter(Boolean).join(" ");

// ── Buttons ────────────────────────────────────────────────────────────────

const BTN =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4 [&_svg]:shrink-0";

function PrimaryButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cx(
        BTN,
        "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {children}
    </a>
  );
}

function GhostButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cx(
        BTN,
        "border border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </a>
  );
}

// ── Install command (copy) ─────────────────────────────────────────────────

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy install command"
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-2 font-mono text-[0.8rem]">
        <span className="text-muted-foreground">$</span>
        <span className="truncate text-foreground">{INSTALL_CMD}</span>
      </span>
      {copied ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          className="size-4 shrink-0 text-success"
        />
      ) : (
        <HugeiconsIcon
          icon={Copy01Icon}
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
    </button>
  );
}

// ── Theme toggle ───────────────────────────────────────────────────────────

// Dependency-free toggle. Fumadocs' RootProvider (next-themes, attribute=class,
// storageKey="theme") applies the stored theme on load by toggling `.dark` on
// <html>. We flip that class and persist to the same key so the choice survives
// reloads and stays in sync with the docs' own switch.
function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // ignore — private mode / storage disabled
    }
    setIsDark(next);
  };
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={toggle}
      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {isDark ? (
        <HugeiconsIcon icon={Sun03Icon} className="size-4" />
      ) : (
        <HugeiconsIcon icon={Moon02Icon} className="size-4" />
      )}
    </button>
  );
}

// ── Wordmark ───────────────────────────────────────────────────────────────

function Wordmark() {
  return (
    <a href="/" className="inline-flex items-baseline gap-1">
      <span className="text-base font-semibold tracking-tight text-foreground">
        otterdeploy
      </span>
      <span className="size-1.5 -translate-y-px rounded-full bg-primary" />
    </a>
  );
}

// ── Code block (light card, subtle syntax) ─────────────────────────────────

function CodeLine({ line }: { line: TerminalLine }) {
  switch (line.type) {
    case "blank":
      return <span>&nbsp;</span>;
    case "command": {
      const rest = line.text.startsWith("$ ") ? line.text.slice(2) : line.text;
      return (
        <span className="text-foreground">
          <span className="text-primary">$ </span>
          {rest}
        </span>
      );
    }
    case "comment":
      return <span className="text-muted-foreground/70">{line.text}</span>;
    case "header":
      return (
        <span className="text-foreground/80">
          <span className="text-muted-foreground">→ </span>
          {line.text.replace(/^→\s*/, "")}
        </span>
      );
    case "metric":
      return (
        <span className="text-foreground/90">
          <span className="text-primary">▸ </span>
          {line.text.replace(/^▸\s*/, "")}
        </span>
      );
    case "final":
      return <span className="font-medium text-success">{line.text}</span>;
    case "success": {
      const idx = line.text.indexOf("✓");
      return (
        <span className="text-foreground/90">
          {line.text.slice(0, idx)}
          <span className="text-success">✓</span>
          {line.text.slice(idx + 1)}
        </span>
      );
    }
    default:
      return <span className="text-muted-foreground">{line.text || " "}</span>;
  }
}

function CodeCard({ title, lines }: { title: string; lines: TerminalLine[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="overflow-x-auto whitespace-pre p-4 font-mono text-[0.78rem] leading-relaxed">
        {lines.map((line, i) => (
          <div key={i}>
            <CodeLine line={line} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top tab bar (right column) ─────────────────────────────────────────────

function TabBar() {
  const [active, setActive] = useState(README_TABS[0].id);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Slide the underline to the active tab. Measured from the rendered button so
  // it stays correct across font loads, resizes, and label changes.
  const measure = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-tab="${active}"]`,
    );
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Scroll-spy: the active tab tracks whichever section sits just below the
  // sticky bar. The narrow band keeps exactly one section active at a time.
  useEffect(() => {
    const sections = README_TABS.map((t) =>
      document.getElementById(t.id),
    ).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-12% 0px -78% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const go = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setActive(id);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-6 lg:px-10">
        <div
          ref={listRef}
          className="relative flex items-center gap-1 overflow-x-auto"
        >
          {README_TABS.map((tab) => {
            const on = active === tab.id;
            return (
              <a
                key={tab.id}
                href={`#${tab.id}`}
                data-tab={tab.id}
                onClick={(e) => go(e, tab.id)}
                className={cx(
                  "px-3 py-3.5 font-mono text-[11px] tracking-wide whitespace-nowrap uppercase transition-colors",
                  on
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </a>
            );
          })}
          {/* sliding underline */}
          <span
            aria-hidden
            className="absolute -bottom-px h-0.5 rounded-full bg-foreground transition-all duration-300 ease-out"
            style={{ left: indicator.left, width: indicator.width }}
          />
        </div>
        <div className="flex items-center gap-1">
          <a
            href="/docs"
            className="hidden rounded-md px-2.5 py-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground sm:block"
          >
            Docs
          </a>
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={GithubIcon} className="size-4" />
          </a>
        </div>
      </div>
    </nav>
  );
}

// ── Section heading (mono kicker, like a README h2) ────────────────────────

function SectionHeading({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="scroll-mt-16 font-mono text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
    >
      {children}
    </h2>
  );
}

// ── Isometric service graph (panel visual, ported from the old hero) ───────
// The 3×3 grid of service "boxes" (web / api / db / …) plus satellite nodes
// connected to the cluster. Uniformly scaled by S so the geometry — and the
// connector lines — stay aligned. Static (no entrance animation) to keep SSR
// hydration trivial; the panel's overflow-hidden clips any edge bleed.
const S = 0.7;

function PanelGraph({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("relative", className)}
      style={{ height: 240 }}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
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
            className="absolute left-1/2 top-1/2"
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
                  <span className="text-[9px] font-medium text-muted-foreground">
                    {label}
                  </span>
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
                borderColor:
                  "color-mix(in oklab, var(--primary) 40%, transparent)",
              }}
            >
              <span className="text-[9px] font-medium text-primary">
                {node.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Left brand panel ───────────────────────────────────────────────────────

function BrandPanel() {
  return (
    <aside className="relative flex min-h-[78vh] flex-col justify-between overflow-hidden border-border bg-background px-7 py-9 lg:fixed lg:inset-y-0 lg:left-0 lg:min-h-screen lg:w-[40%] lg:border-r lg:px-12 lg:py-12 xl:w-[38%]">
      {/* faint dot-grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.6]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 30% 40%, #000 20%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 30% 40%, #000 20%, transparent 75%)",
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
          Deploy anything,{" "}
          <span className="text-primary">on your own infra.</span>
        </h1>
        <p className="mt-5 max-w-sm text-[0.95rem] leading-relaxed text-muted-foreground">
          A self-hostable deployment platform. Ship apps, databases, and
          services behind a Caddy edge — with live logs, metrics, and access
          control. The control of self-hosting, the ergonomics of a PaaS.
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

// ── Feature grid (numbered hairline cells) ─────────────────────────────────

function FeatureGrid() {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_CELLS.map((cell) => (
          <div key={cell.n} className="flex flex-col bg-background p-5">
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {cell.n}
            </span>
            <h3 className="mt-3 text-sm font-semibold tracking-tight text-foreground">
              {cell.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {cell.desc}
            </p>
            <span className="mt-4 truncate font-mono text-[11px] text-muted-foreground/60">
              {cell.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function ReadmeLanding() {
  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <BrandPanel />

      <div className="lg:ml-[40%] xl:ml-[38%]">
        <TabBar />

        <div className="mx-auto px-10 py-12 ">
          {/* README intro */}
          <section id="readme" className="scroll-mt-16">
            <SectionHeading>Readme</SectionHeading>
            <p className="mt-4 text-[1.05rem] leading-relaxed text-foreground/90">
              Otterdeploy is a deployment platform that{" "}
              <span className="font-medium text-foreground">
                runs on your own servers
              </span>
              . Composable, typed end to end, and built to scale — from a single
              VPS to a multi-node swarm, without the usage-based bills or vendor
              lock-in.
            </p>
            <div className="mt-6">
              <InstallCommand />
            </div>

            {/* Built on */}
            <div className="mt-10">
              <div className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70 uppercase">
                Built on
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {BUILT_ON.map((name) => (
                  <span
                    key={name}
                    className="font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="mt-16 scroll-mt-16">
            <SectionHeading>Features</SectionHeading>
            <p className="mt-3 mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              A complete self-hosted platform — git builds, a Caddy edge,
              managed data, live observability, and access control — driven from
              one CLI.
            </p>
            <FeatureGrid />
          </section>

          {/* Walkthrough code */}
          <section id="deploy" className="mt-16 scroll-mt-16">
            <SectionHeading>One command, clone to production</SectionHeading>
            <p className="mt-3 mb-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Push your repo. Railpack detects the framework, builds it, and the
              Caddy edge serves it over HTTPS — zero-downtime, automatic TLS.
            </p>
            <CodeCard title="otterdeploy deploy" lines={DEPLOY_LINES} />
          </section>
        </div>

        {/* Footer */}
        <footer className="border-t border-border px-6 py-8 lg:px-10">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
            <Wordmark />
            <span className="font-mono text-[11px] text-muted-foreground">
              © {new Date().getFullYear()} otterdeploy · built for people who run
              their own infra
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}
