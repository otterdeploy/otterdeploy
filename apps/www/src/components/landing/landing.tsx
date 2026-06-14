import { Check, Copy, Heart, Server, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  DEPLOY_LINES,
  FEATURE_TABS,
  FOOTER_COLS,
  GITHUB_URL,
  GRID_CELLS,
  INSTALL_CMD,
  NAV_LINKS,
  OPEN_SOURCE_BULLETS,
  SATELLITE_NODES,
  SELF_HOST_BULLETS,
} from "./content";
import type { TerminalLine } from "./content";

// All color comes from the shared design tokens defined in styles/app.css
// (the same warm-neutral + Signal Blue palette as apps/web). Sections that
// should read as a "dark band" carry a `dark` class, which re-scopes those
// CSS variables to their dark values for everything inside.

const cx = (...parts: Array<string | false | undefined>) =>
  parts.filter(Boolean).join(" ");

// ───────────────────────────────────────────────────────────────────────────
// Hooks
// ───────────────────────────────────────────────────────────────────────────

const useIso = typeof document !== "undefined" ? useLayoutEffect : useEffect;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const onChange = () => setReduce(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function useInViewOnce(rootMargin = "0px") {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    // Safety: never leave content gated if the observer never fires.
    const safety = window.setTimeout(() => setInView(true), 1600);
    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, [rootMargin]);
  return { ref, inView };
}

// ───────────────────────────────────────────────────────────────────────────
// Reveal — SSR/no-JS renders fully visible; client hides before paint, then
// reveals on scroll. Reduced motion (and a safety timeout) keep it visible.
// ───────────────────────────────────────────────────────────────────────────

function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.style.opacity = "0";
    el.style.transform = `translateY(${y}px)`;
    el.style.willChange = "opacity, transform";
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      el.style.transition = `opacity .7s cubic-bezier(.22,1,.36,1) ${delay}ms, transform .7s cubic-bezier(.22,1,.36,1) ${delay}ms`;
      el.style.opacity = "1";
      el.style.transform = "none";
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            reveal();
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    const safety = window.setTimeout(reveal, 1400);
    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, [delay, y]);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Ambient background — faint token-colored dot grid + a soft primary wash
// ───────────────────────────────────────────────────────────────────────────

function AmbientBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage:
            "radial-gradient(ellipse 100% 70% at 50% 0%, #000 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 100% 70% at 50% 0%, #000 30%, transparent 80%)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[640px]"
        style={{
          background:
            "radial-gradient(ellipse 58% 50% at 50% -8%, color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%)",
        }}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Buttons
// ───────────────────────────────────────────────────────────────────────────

// Mirrors apps/web's shadcn Button base + size(default) + variant. Default
// variant for PrimaryButton, outline variant for GhostButton.
const BTN_BASE =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-clip-padding px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cx(BTN_BASE, "bg-primary text-primary-foreground [a]:hover:bg-primary/80")}
    >
      {children}
    </a>
  );
}

function GhostButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cx(
        BTN_BASE,
        "border-border bg-background text-foreground hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
      )}
    >
      {children}
    </a>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Install command (copy)
// ───────────────────────────────────────────────────────────────────────────

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="group flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
      aria-label="Copy install command"
    >
      <span className="flex min-w-0 items-center gap-2 font-mono text-[0.8rem]">
        <span className="text-muted-foreground">$</span>
        <span className="truncate text-foreground">{INSTALL_CMD}</span>
      </span>
      {copied ? (
        <Check className="size-4 shrink-0 text-success" />
      ) : (
        <Copy className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Terminal — always dark (scoped `.dark` so tokens resolve to dark values)
// ───────────────────────────────────────────────────────────────────────────

function TerminalLineView({ line }: { line: TerminalLine }) {
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
      return <span className="text-muted-foreground">{line.text}</span>;
    case "header": {
      const rest = line.text.replace(/^→\s*/, "");
      return (
        <span className="text-foreground">
          <span className="text-muted-foreground">→ </span>
          {rest}
        </span>
      );
    }
    case "metric": {
      const rest = line.text.replace(/^▸\s*/, "");
      return (
        <span className="text-foreground/90">
          <span className="text-primary">▸ </span>
          {rest}
        </span>
      );
    }
    case "log":
      return <span className="text-muted-foreground">{line.text}</span>;
    case "final":
      return <span className="font-medium text-success">{line.text}</span>;
    case "success": {
      const t = line.text;
      const idx = t.indexOf("✓");
      const pre = t.slice(0, idx);
      const after = t.slice(idx + 1);
      const [main, path] = after.split("→");
      return (
        <span className="text-foreground">
          {pre}
          <span className="text-success">✓</span>
          {main}
          {path && (
            <>
              <span className="text-muted-foreground">→</span>
              <span className="text-primary">{path}</span>
            </>
          )}
        </span>
      );
    }
    default:
      return <span className="text-foreground">{line.text || " "}</span>;
  }
}

function TerminalWindow({
  title,
  lines,
  animate,
}: {
  title: string;
  lines: TerminalLine[];
  animate?: boolean;
}) {
  const { ref, inView } = useInViewOnce("-80px");
  const reduce = usePrefersReducedMotion();
  // Default fully visible; type out only when scrolled into view with motion.
  const [count, setCount] = useState(lines.length);
  useEffect(() => {
    if (!animate || !inView || reduce) return;
    let i = 0;
    setCount(0);
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= lines.length) clearInterval(id);
    }, 150);
    return () => clearInterval(id);
  }, [animate, inView, reduce, lines.length]);

  return (
    <div
      ref={ref}
      className="dark overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "0 24px 60px -28px rgba(0,0,0,0.55)" }}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          {title}
        </span>
      </div>
      <div
        className="whitespace-pre p-4 font-mono text-[0.78rem] leading-relaxed lg:p-5"
        style={{ minHeight: `${lines.length * 1.62}em` }}
      >
        {lines.slice(0, count).map((line, i) => (
          <div key={i}>
            <TerminalLineView line={line} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Isometric service graph (hero visual)
// ───────────────────────────────────────────────────────────────────────────

function ServiceGraph() {
  const { ref, inView } = useInViewOnce("-40px");
  const reduce = usePrefersReducedMotion();
  const show = inView || reduce;

  return (
    <div ref={ref} className="relative mt-12 h-[280px] sm:h-[380px] md:h-[440px]">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.58] sm:scale-[0.84] md:scale-100">
        <div className="relative" style={{ width: 500, height: 400 }}>
          <svg className="absolute inset-0 size-full" style={{ zIndex: 0 }} aria-hidden>
            {SATELLITE_NODES.map((node, i) => (
              <line
                key={node.label}
                x1="50%"
                y1="50%"
                x2={`calc(50% + ${node.x + 28}px)`}
                y2={`calc(50% + ${node.y + 12}px)`}
                stroke="var(--primary)"
                strokeWidth="1"
                strokeOpacity={show ? 0.4 : 0}
                style={{ transition: `stroke-opacity .6s ease ${0.5 + i * 0.08}s` }}
              />
            ))}
          </svg>

          <div
            className="absolute left-1/2 top-1/2"
            style={{
              transform: "translate(-50%, -50%) rotateX(55deg) rotateZ(-45deg)",
              transformStyle: "preserve-3d",
            }}
          >
            <div className="grid grid-cols-3 gap-2.5" style={{ width: 252, height: 252 }}>
              {GRID_CELLS.map((label, i) => (
                <div
                  key={label}
                  className="flex size-[78px] items-center justify-center rounded-lg border border-border bg-card font-mono"
                  style={{
                    opacity: show ? 1 : 0,
                    transform: show ? "scale(1)" : "scale(0.4)",
                    transition: `opacity .5s ease ${i * 0.06}s, transform .5s cubic-bezier(.22,1,.36,1) ${i * 0.06}s`,
                  }}
                >
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {SATELLITE_NODES.map((node, i) => (
            <div
              key={node.label}
              className="absolute rounded-md border bg-card px-3 py-1.5 font-mono"
              style={{
                left: `calc(50% + ${node.x}px)`,
                top: `calc(50% + ${node.y}px)`,
                borderColor: "color-mix(in oklab, var(--primary) 40%, transparent)",
                opacity: show ? 1 : 0,
                transform: show ? "scale(1)" : "scale(0.8)",
                transition: `opacity .45s ease ${0.5 + i * 0.1}s, transform .45s ease ${0.5 + i * 0.1}s`,
              }}
            >
              <span className="text-[10px] font-medium text-primary">
                {node.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Glyphs
// ───────────────────────────────────────────────────────────────────────────

function GithubGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Nav
// ───────────────────────────────────────────────────────────────────────────

export function Nav({ dark }: { dark?: boolean }) {
  return (
    <nav
      className={cx(
        dark && "dark",
        "fixed inset-x-0 top-0 z-50 border-b border-border bg-background/72 backdrop-blur-xl",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <a href="/" className="flex items-center gap-1.5">
          <span className="text-[0.95rem] font-semibold tracking-tight text-foreground">
            otterstack
          </span>
          <span className="mb-2 size-1.5 rounded-full bg-primary" />
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            className="hidden size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground sm:flex"
            aria-label="GitHub"
          >
            <GithubGlyph className="size-[18px]" />
          </a>
          <PrimaryButton href="/docs">Get started</PrimaryButton>
        </div>
      </div>
    </nav>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Hero
// ───────────────────────────────────────────────────────────────────────────

export function Hero({ dark }: { dark?: boolean }) {
  return (
    <section
      className={cx(
        dark && "dark",
        "relative overflow-hidden bg-background px-5 pt-32 pb-20 md:pt-36",
      )}
    >
      <AmbientBackground />
      <div className="relative mx-auto max-w-5xl text-center">
        <Reveal className="flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Self-hostable · open platform
          </span>
        </Reveal>

        <Reveal delay={60}>
          <h1
            className="mx-auto mt-7 max-w-3xl font-semibold tracking-tight text-balance text-foreground"
            style={{
              fontSize: "clamp(2.5rem, 6vw, 4.25rem)",
              lineHeight: 1.04,
              letterSpacing: "-0.03em",
            }}
          >
            Deploy anything,{" "}
            <span className="text-primary">on your own infra.</span>
          </h1>
        </Reveal>

        <Reveal delay={140}>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-balance text-muted-foreground">
            Otterstack ships your apps, databases, and services behind a Caddy
            edge — with live logs, metrics, and access control. The control of
            self-hosting, the ergonomics of a PaaS.
          </p>
        </Reveal>

        <Reveal delay={220} className="mx-auto mt-9 flex max-w-md justify-center">
          <InstallCommand />
        </Reveal>

        <Reveal
          delay={300}
          className="mt-5 flex flex-wrap items-center justify-center gap-3"
        >
          <PrimaryButton href="/docs">
            Read the docs
            <ArrowGlyph />
          </PrimaryButton>
          <GhostButton href={GITHUB_URL}>
            <Star className="size-4" />
            Star on GitHub
          </GhostButton>
        </Reveal>

        <ServiceGraph />
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Deploy terminal band
// ───────────────────────────────────────────────────────────────────────────

export function DeployBand({ dark }: { dark?: boolean }) {
  return (
    <section
      className={cx(
        dark && "dark",
        "relative overflow-hidden border-t border-border bg-background px-5 py-24",
      )}
    >
      <AmbientBackground />
      <div className="relative mx-auto max-w-3xl">
        <Reveal className="mb-8 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            One command from clone to production.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-base text-muted-foreground">
            Push your repo. Railpack detects the framework, builds it, and the
            Caddy edge serves it over HTTPS.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <TerminalWindow title="terminal" lines={DEPLOY_LINES} animate />
        </Reveal>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Feature sections with a sticky tab bar
// ───────────────────────────────────────────────────────────────────────────

function FeatureRow({
  tab,
  reverse,
  setActive,
}: {
  tab: (typeof FEATURE_TABS)[number];
  reverse: boolean;
  setActive: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setActive(tab.key);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tab.key, setActive]);

  const Icon = tab.icon;

  return (
    <div
      ref={ref}
      id={`feature-${tab.key}`}
      className="scroll-mt-32 border-t border-border px-5 py-20"
    >
      <Reveal className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-2">
        <div className={cx("min-w-0", reverse && "lg:order-2")}>
          <div className="mb-4 inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-wider text-primary">
            <Icon className="size-4" />
            {tab.label}
          </div>
          <h3 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            {tab.heading}
          </h3>
          <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">
            {tab.desc}
          </p>
          <ul className="mt-7 flex flex-col gap-3.5">
            {tab.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Check className="size-3 text-primary" />
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={cx("min-w-0", reverse && "lg:order-1")}>
          <TerminalWindow title={tab.terminal.title} lines={tab.terminal.lines} />
        </div>
      </Reveal>
    </div>
  );
}

export function FeatureTabs({ dark }: { dark?: boolean }) {
  const [active, setActive] = useState(FEATURE_TABS[0].key);
  const setActiveCb = useCallback((key: string) => setActive(key), []);

  const scrollTo = (key: string) => {
    document
      .getElementById(`feature-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section
      id="features"
      className={cx(dark && "dark", "bg-background")}
    >
      <div className="px-5 pt-24 pb-14 text-center">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
            Everything you need to ship
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            A complete self-hosted platform — git builds, a Caddy edge, managed
            data, live observability, and access control — driven from one CLI.
          </p>
        </Reveal>
      </div>

      <div className="sticky top-14 z-40 overflow-x-auto border-y border-border bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl">
          {FEATURE_TABS.map((tab) => {
            const on = active === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => scrollTo(tab.key)}
                className={cx(
                  "flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3.5 font-mono text-xs font-medium whitespace-nowrap transition-colors",
                  on
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {FEATURE_TABS.map((tab, i) => (
        <FeatureRow
          key={tab.key}
          tab={tab}
          reverse={i % 2 === 1}
          setActive={setActiveCb}
        />
      ))}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Two columns — why self-host / open platform
// ───────────────────────────────────────────────────────────────────────────

export function ValueColumns({ dark }: { dark?: boolean }) {
  const cols = [
    { icon: Server, title: "Why self-host?", bullets: SELF_HOST_BULLETS },
    { icon: Heart, title: "Open platform", bullets: OPEN_SOURCE_BULLETS },
  ];
  return (
    <section
      id="self-host"
      className={cx(dark && "dark", "border-t border-border bg-background px-5 py-24")}
    >
      <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2 md:gap-16">
        {cols.map((col, i) => {
          const Icon = col.icon;
          return (
            <Reveal key={col.title} delay={i * 80}>
              <div className="mb-6 flex items-center gap-2.5">
                <Icon className="size-5 text-primary" />
                <h3 className="text-xl font-semibold tracking-tight text-foreground">
                  {col.title}
                </h3>
              </div>
              <ul className="flex flex-col gap-3.5">
                {col.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {b}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// CTA band — dark in both variants
// ───────────────────────────────────────────────────────────────────────────

export function CtaBand() {
  return (
    <section
      id="cta"
      className="dark relative overflow-hidden border-t border-border bg-background px-5 py-28"
    >
      <AmbientBackground />
      <div className="relative mx-auto max-w-2xl text-center">
        <Reveal>
          <h2 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
            Deploy on your own servers.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            One command. Your infrastructure. Your rules.
          </p>
        </Reveal>
        <Reveal delay={120} className="mx-auto mt-8 flex max-w-md justify-center">
          <InstallCommand />
        </Reveal>
        <Reveal
          delay={200}
          className="mt-5 flex flex-wrap items-center justify-center gap-3"
        >
          <PrimaryButton href="/docs">
            Read the docs
            <ArrowGlyph />
          </PrimaryButton>
          <GhostButton href={GITHUB_URL}>
            <Star className="size-4" />
            Star on GitHub
          </GhostButton>
        </Reveal>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Footer
// ───────────────────────────────────────────────────────────────────────────

export function Footer({ dark }: { dark?: boolean }) {
  return (
    <footer
      className={cx(dark && "dark", "border-t border-border bg-background px-5 py-14")}
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.95rem] font-semibold tracking-tight text-foreground">
                otterstack
              </span>
              <span className="mb-2 size-1.5 rounded-full bg-primary" />
            </div>
            <p className="mt-3 max-w-[16rem] text-sm leading-relaxed text-muted-foreground">
              A self-hostable deployment platform. Open, typed end to end, and
              yours to run.
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {col.title}
              </h4>
              <div className="mt-3 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <span className="font-mono text-xs text-muted-foreground">
            © 2026 otterstack
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            built for people who run their own infra
          </span>
        </div>
      </div>
    </footer>
  );
}
