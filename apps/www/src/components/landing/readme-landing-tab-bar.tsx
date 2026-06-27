import { useCallback, useEffect, useRef, useState } from "react";

import { GithubIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { GITHUB_URL, README_TABS } from "./content";
import { cx } from "./readme-landing-primitives";

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

// ── Top tab bar (right column) ─────────────────────────────────────────────

export function TabBar() {
  const [active, setActive] = useState(README_TABS[0].id);
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Slide the underline to the active tab. Measured from the rendered button so
  // it stays correct across font loads, resizes, and label changes.
  const measure = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
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
    const sections = README_TABS.map((t) => document.getElementById(t.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
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
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-6 lg:px-10">
        <div ref={listRef} className="relative flex items-center gap-1 overflow-x-auto">
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
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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
