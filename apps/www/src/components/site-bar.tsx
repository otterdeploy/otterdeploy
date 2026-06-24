import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouterState } from "@tanstack/react-router";

import { GITHUB_URL } from "@/components/landing/content";

// Marketing top bar shared above the docs — our own mono/uppercase header.
// Icons are Hugeicons (no lucide).

const cx = (...parts: Array<string | false | undefined>) =>
  parts.filter(Boolean).join(" ");

const LINKS: { label: string; href: string; match: (p: string) => boolean }[] =
  [
    { label: "Readme", href: "/", match: (p) => p === "/" },
    {
      label: "Docs",
      href: "/docs",
      match: (p) => p.startsWith("/docs") && !p.startsWith("/docs/reference"),
    },
    {
      label: "API",
      href: "/docs/reference/api",
      match: (p) => p.startsWith("/docs/reference"),
    },
  ];

export function SiteBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex h-full items-center gap-6 px-5 lg:px-6">
        <a href="/" className="inline-flex items-baseline gap-1">
          <span className="text-base font-semibold tracking-tight text-foreground">
            otterdeploy
          </span>
          <span className="size-1.5 translate-y-[-1px] rounded-full bg-primary" />
        </a>

        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const on = l.match(pathname);
            return (
              <a
                key={l.label}
                href={l.href}
                className={cx(
                  "rounded-md px-2.5 py-1.5 font-mono text-[11px] tracking-wide uppercase transition-colors",
                  on
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </a>
            );
          })}
        </nav>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="ml-auto grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={GithubIcon} className="size-[18px]" />
        </a>
      </div>
    </header>
  );
}
