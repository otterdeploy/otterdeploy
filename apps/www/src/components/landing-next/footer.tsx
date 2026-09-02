import { GithubIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { OtterdeployMark } from "@/components/brand/otterdeploy-mark";

import { GITHUB_URL } from "../landing/content";
import { Container, cx, Mono } from "../landing/primitives";

/**
 * The footer, warmed up: a soft brand glow rising from the bottom instead of
 * flat cold black, a branded (not grey) wordmark that reads as light rather
 * than a watermark, a friendly "star us" invite, and a human sign-off. Clean
 * link columns keep the Linear bones; the warmth is in the light and the copy.
 */

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Graph", href: "/#graph" },
      { label: "Deployments", href: "/#deploys" },
      { label: "Data workbench", href: "/#data" },
      { label: "Templates", href: "/#templates" },
      { label: "CLI", href: "/#cli" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "Getting started", href: "/docs/start/first-deploy" },
      { label: "CLI reference", href: "/docs/cli" },
      { label: "API reference", href: "/docs/reference/api" },
      { label: "Manifest", href: "/docs/reference/manifest" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "Discussions", href: `${GITHUB_URL}/discussions` },
      { label: "Issues", href: `${GITHUB_URL}/issues` },
      { label: "Changelog", href: `${GITHUB_URL}/releases` },
      { label: "License · AGPL-3.0", href: `${GITHUB_URL}/blob/main/LICENSE` },
    ],
  },
];

function Column({ title, links }: (typeof COLUMNS)[number]) {
  return (
    <nav aria-label={title}>
      <h2 className="text-[0.8125rem] font-medium text-foreground">{title}</h2>
      <ul className="mt-3.5 space-y-2.5">
        {links.map((link) => {
          const ext = link.href.startsWith("http");
          return (
            <li key={link.label}>
              <a
                href={link.href}
                {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}
                className="rounded-sm text-[0.8125rem] text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function NextFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[#3d7bfb]/15">
      {/* Warm ambient light rising from the bottom, so the page closes on a
          soft glow rather than a sheet of cold black. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <div
          className="absolute inset-x-0 bottom-0 h-[34rem]"
          style={{
            backgroundImage:
              "radial-gradient(70% 90% at 50% 108%, rgba(61,123,251,0.14), rgba(61,123,251,0.05) 34%, transparent 66%)",
          }}
        />
      </div>

      <Container className="relative z-10 pt-16 pb-40">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <span className="inline-flex items-center gap-2 text-foreground">
              <OtterdeployMark size={20} />
              <span className="text-[0.95rem] font-semibold tracking-tight">otterdeploy</span>
            </span>
            <p className="mt-4 max-w-[34ch] text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
              A control plane you actually own — the ergonomics of a managed platform, running on
              servers you rent, no seats, no usage bill. Come build it with us.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 rounded-full border border-[#3d7bfb]/25 bg-[#3d7bfb]/[0.06] py-1.5 pr-3.5 pl-3 text-[0.8125rem] font-medium text-foreground transition-colors duration-200 hover:bg-[#3d7bfb]/[0.12] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <HugeiconsIcon
                  icon={StarIcon}
                  className="size-3.5 text-[#7ab5ff] transition-transform duration-200 group-hover:scale-110"
                />
                Star on GitHub
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="otterdeploy on GitHub"
                className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-white/[0.06] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <HugeiconsIcon icon={GithubIcon} className="size-4" />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <Column key={col.title} {...col} />
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/[0.06] pt-6">
          <Mono className="text-muted-foreground/70">
            © {new Date().getFullYear()} otterdeploy contributors · AGPL-3.0
          </Mono>
          <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-muted-foreground/80">
            Made with care by self-hosters, for self-hosters
            <span aria-hidden className="text-[#7ab5ff]">
              ♥
            </span>
          </span>
        </div>
      </Container>

      {/* Giant wordmark, tinted with the brand so it reads as warm light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex justify-center overflow-hidden"
      >
        <span
          className={cx(
            "translate-y-[30%] bg-gradient-to-b from-[#7ab5ff]/[0.16] via-[#3d7bfb]/[0.07] to-transparent bg-clip-text text-transparent select-none",
            "text-[24vw] leading-none font-semibold tracking-[-0.04em] whitespace-nowrap",
          )}
        >
          otterdeploy
        </span>
      </div>
    </footer>
  );
}
