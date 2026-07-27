import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouterState } from "@tanstack/react-router";

import { Wordmark } from "@/components/brand/otterdeploy-mark";
import { GITHUB_URL } from "@/components/landing/content";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The marketing bar that sits above the docs layout.
 *
 * Shares the landing page's wordmark and link styling, so crossing from the
 * marketing site into the docs doesn't feel like leaving the product. Icons are
 * Hugeicons (no lucide).
 */

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

const LINKS: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: "Home", href: "/", match: (p) => p === "/" },
  {
    label: "Docs",
    href: "/docs",
    match: (p) => p.startsWith("/docs") && !isApi(p),
  },
  { label: "API", href: "/docs/reference/api", match: isApi },
];

function isApi(pathname: string): boolean {
  return pathname.startsWith("/docs/reference/api") || pathname.startsWith("/docs/openapi");
}

export function SiteBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex h-full items-center gap-6 px-5 lg:px-6">
        <Wordmark />

        <nav aria-label="Site" className="flex items-center gap-1">
          {LINKS.map((l) => {
            const on = l.match(pathname);
            return (
              <a
                key={l.label}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {l.label}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="otterdeploy on GitHub"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <HugeiconsIcon icon={GithubIcon} className="size-[18px]" />
          </a>
        </div>
      </div>
    </header>
  );
}
