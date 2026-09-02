import { GITHUB_URL, INSTALL_CMD } from "../landing/content";
import { CommandLine, Container } from "../landing/primitives";
import { NEXT_STATS } from "./content";
import { HeroCanvas } from "./hero-canvas";
import { AppWindow } from "./window";

/**
 * Hero, Linear-shaped: a large left-set headline, one muted sentence, a small
 * annotation, and the real control plane in a browser frame cut by the fold.
 */
export function NextHero() {
  return (
    <header className="relative overflow-hidden border-b border-border">
      {/* The deploy craft over its lattice horizon, riding the hero's right
          side. Masked so it dissolves into the copy and the fold. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 hidden h-[36rem] w-[62%] lg:block"
        style={{
          maskImage:
            "linear-gradient(to left, #000 55%, transparent 96%), linear-gradient(to top, transparent 4%, #000 30%)",
          maskComposite: "intersect",
          WebkitMaskImage:
            "linear-gradient(to left, #000 55%, transparent 96%), linear-gradient(to top, transparent 4%, #000 30%)",
          WebkitMaskComposite: "source-in",
        }}
      >
        <HeroCanvas />
      </div>

      <Container className="relative z-10 pt-28 lg:pt-36">
        <h1 className="max-w-[15ch] text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.024em] text-balance text-foreground sm:text-[3.75rem]">
          The control plane for servers you own
        </h1>

        <p className="mt-6 max-w-[54ch] text-[1rem] leading-normal text-pretty text-muted-foreground">
          One dashboard for your whole stack: a project graph, deployments, live logs and metrics, a
          database workbench, and 98 one-click apps. Self-hosted, on your VPS.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <a
            href="/docs/start/first-deploy"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-[0.9375rem] font-medium whitespace-nowrap text-primary-foreground transition-[background-color,translate] duration-200 outline-none select-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
          >
            Start deploying
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm text-[0.9375rem] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            Read the source ›
          </a>
        </div>

        <div className="mt-6 max-w-[34rem]">
          <CommandLine command={INSTALL_CMD} label="install" />
          <p className="mt-2 pl-1 font-mono text-[0.7rem] text-muted-foreground/70">
            one command on a fresh VPS — installs and starts the control plane.
          </p>
        </div>

        <div className="mt-12 lg:mt-16">
          <AppWindow />
        </div>
      </Container>
    </header>
  );
}

export function Stats() {
  return (
    <section aria-label="otterdeploy in numbers" className="border-b border-border">
      <Container className="py-14 lg:py-16">
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
          {NEXT_STATS.map((stat) => (
            <li key={stat.label} className="flex flex-col gap-2 bg-background px-6 py-8">
              <span className="text-[2.75rem] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums sm:text-[3.25rem]">
                {stat.value}
              </span>
              <span className="text-[0.8125rem] leading-snug text-muted-foreground">
                {stat.label}
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
