import { ArrowRight01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Wordmark } from "@/components/brand/otterdeploy-mark";

import { FOOTER_LINKS, GITHUB_URL, INSTALL_CMD, REQUIREMENTS } from "./content";
import {
  Band,
  CommandLine,
  Container,
  Mono,
  OutlineButton,
  PrimaryButton,
  StateChip,
} from "./primitives";

/**
 * The close. One command, three requirements, and the pre-1.0 warning stated
 * here rather than buried — a self-hoster finding that out after installing is
 * how you lose them permanently.
 */
export function GetStarted() {
  return (
    <Band id="start" tone="ink">
      <Container className="py-20 text-center lg:py-24">
        <h2 className="mx-auto max-w-[20ch] text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[2.5rem]">
          One box, one command, your own platform.
        </h2>
        <p className="mx-auto mt-5 max-w-[54ch] text-[1rem] leading-relaxed text-pretty text-muted-foreground">
          The installer provisions the host, pulls the published images, puts Docker into Swarm mode
          and brings the stack up — with the host firewall and CrowdSec on by default.
        </p>

        <div className="mx-auto mt-9 max-w-[38rem]">
          <CommandLine command={INSTALL_CMD} />
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <PrimaryButton href="/docs/start/first-deploy">
            Get started
            <HugeiconsIcon icon={ArrowRight01Icon} />
          </PrimaryButton>
          <OutlineButton href={GITHUB_URL} target="_blank" rel="noreferrer">
            <HugeiconsIcon icon={GithubIcon} />
            Read the source
          </OutlineButton>
        </div>

        <dl className="mx-auto mt-14 grid max-w-[52rem] gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-3">
          {REQUIREMENTS.map((req) => (
            <div key={req.label} className="bg-background px-5 py-4 text-left">
              <dt>
                <Mono className="text-muted-foreground">{req.label}</Mono>
              </dt>
              <dd className="mt-1.5 text-[0.875rem] leading-snug text-foreground">{req.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mx-auto mt-10 flex max-w-[58ch] flex-col items-center gap-3">
          <StateChip tone="warning">pre-1.0</StateChip>
          <p className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
            otterdeploy is under active development. Interfaces and schemas still change without
            migration paths, so it isn't recommended for production workloads yet — run it on
            something you'd be willing to rebuild.
          </p>
        </div>
      </Container>
    </Band>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border">
      <Container className="grid gap-10 py-12 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))] md:gap-12">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-[36ch] text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
            A self-hostable deployment platform. The control of running your own infrastructure,
            with the ergonomics of a managed one.
          </p>
        </div>

        {FOOTER_LINKS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-[0.8125rem] font-medium text-foreground">{column.title}</h2>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => {
                const external = link.href.startsWith("http");
                return (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="rounded-sm text-[0.8125rem] text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                    >
                      {link.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        ))}
      </Container>

      <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-6">
        <Mono className="text-muted-foreground">
          © {new Date().getFullYear()} otterdeploy contributors · AGPL-3.0
        </Mono>
        <Mono className="text-muted-foreground">built for people who run their own infra</Mono>
      </Container>
    </footer>
  );
}
