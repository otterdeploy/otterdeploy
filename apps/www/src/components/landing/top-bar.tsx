import { useEffect, useState } from "react";

import { ArrowRight01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Wordmark } from "@/components/brand/otterdeploy-mark";
import { ThemeToggle } from "@/components/theme-toggle";

import { GITHUB_URL, NAV_SECTIONS } from "./content";
import { cx } from "./primitives";

/**
 * A floating pill nav: detached from the page edge, so it reads as an
 * instrument laid on top of the page rather than a bar the page hangs from.
 * Three zones — identity left, the section map dead centre, actions right,
 * ending on the one thing we want a visitor to do. Fixed, so the CTA is on
 * screen for the entire scroll.
 *
 * Section links are a scroll-spy: the active one is the section currently
 * under the bar. Plain anchors, so they work before hydration and land
 * correctly if JavaScript never arrives.
 */
export function TopBar() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(
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
      // A narrow band just below the bar, so exactly one section is active.
      { rootMargin: "-10% 0px -80% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <div className="fixed inset-x-0 top-4 z-30 px-4">
      <div className="mx-auto grid h-12 w-full max-w-[62rem] grid-cols-[1fr_auto] items-center gap-3 rounded-full border border-border bg-background/85 pr-1.5 pl-4 shadow-[0_8px_30px_-18px_rgba(20,20,18,0.35)] backdrop-blur-md lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 items-center">
          <Wordmark />
        </div>

        {/* The centre zone: sections only, so the middle of the bar is a map
            of the page and nothing else. */}
        <nav aria-label="Sections" className="hidden min-w-0 items-center justify-center lg:flex">
          {NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              className={cx(
                "rounded-full px-3 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                active === section.id ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-1">
          <a
            href="/docs"
            className="hidden rounded-full px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:block"
          >
            Docs
          </a>
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="otterdeploy on GitHub"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px"
          >
            <HugeiconsIcon icon={GithubIcon} className="size-4" />
          </a>
          <a
            href="/docs/start/first-deploy"
            className="ml-0.5 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[0.8125rem] font-medium whitespace-nowrap text-primary-foreground transition-[background-color,translate] duration-200 outline-none select-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
          >
            Get started
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
