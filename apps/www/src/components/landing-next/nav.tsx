import { useEffect, useState } from "react";

import { ArrowRight01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Wordmark } from "@/components/brand/otterdeploy-mark";

import { GITHUB_URL } from "../landing/content";
import { cx } from "../landing/primitives";
import { NEXT_NAV_SECTIONS } from "./content";

/**
 * The bar, Railway-shaped: identity left, the section map centre, the one
 * thing a visitor should do on the right. No theme toggle — this page is
 * night-only, like the reference. Sticky and translucent so the sky shows
 * through as it scrolls past.
 */
export function NextNav() {
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = NEXT_NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(
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
      { rootMargin: "-10% 0px -80% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={cx(
        "sticky top-0 z-30 transition-colors duration-300",
        scrolled
          ? "border-b border-border/60 bg-background/70 backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto grid h-14 w-full max-w-[76rem] grid-cols-[1fr_auto] items-center gap-4 px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-10">
        <div className="flex min-w-0 items-center">
          <Wordmark />
        </div>

        <nav aria-label="Sections" className="hidden items-center justify-center gap-1 lg:flex">
          {NEXT_NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              className={cx(
                "rounded-md px-3 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                active === section.id ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-1">
          <a
            href="/docs"
            className="hidden rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:block"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="otterdeploy on GitHub"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px"
          >
            <HugeiconsIcon icon={GithubIcon} className="size-4" />
          </a>
          <a
            href="/docs/start/first-deploy"
            className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[0.8125rem] font-medium whitespace-nowrap text-primary-foreground transition-[background-color,translate] duration-200 outline-none select-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
          >
            Deploy
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
