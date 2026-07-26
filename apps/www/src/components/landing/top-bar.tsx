import { useEffect, useState } from "react";

import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Wordmark } from "@/components/brand/otterdeploy-mark";
import { ThemeToggle } from "@/components/theme-toggle";

import { GITHUB_URL, NAV_SECTIONS } from "./content";
import { Container, cx } from "./primitives";

/**
 * The site header. Section links are a scroll-spy: the active one is the
 * section currently under the bar. Plain anchors, so they work before
 * hydration and land correctly if JavaScript never arrives.
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
    <div className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <Container className="flex h-14 items-center gap-6">
        <Wordmark />

        <nav aria-label="Sections" className="hidden min-w-0 items-center lg:flex">
          {NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              className={cx(
                "rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                active === section.id ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <a
            href="/docs"
            className="rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            Docs
          </a>
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="otterdeploy on GitHub"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px"
          >
            <HugeiconsIcon icon={GithubIcon} className="size-4" />
          </a>
        </div>
      </Container>
    </div>
  );
}
