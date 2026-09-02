import { GITHUB_URL } from "../landing/content";
import { Band, Container } from "../landing/primitives";

/**
 * The close, Linear-plain: one line, one action, no gradient, no panel.
 */
export function Close() {
  return (
    <Band>
      <Container className="flex flex-col items-center py-24 text-center lg:py-32">
        <h2 className="max-w-[24ch] text-[2rem] leading-[1.1] font-semibold tracking-[-0.022em] text-balance sm:text-[2.625rem]">
          Grab a VPS. Ship tonight.
        </h2>
        <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
          Open source, no seats, no usage bill. Pre-1.0, run it on something you'd be willing to
          rebuild.
        </p>
        <div className="mt-8 flex items-center gap-6">
          <a
            href="/docs/start/first-deploy"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[0.875rem] font-medium whitespace-nowrap text-primary-foreground transition-[background-color,translate] duration-200 outline-none select-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
          >
            Start deploying
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm text-[0.875rem] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            Read the source ›
          </a>
        </div>
      </Container>
    </Band>
  );
}
