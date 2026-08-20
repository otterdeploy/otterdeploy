import { ArrowRight01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { GITHUB_URL, HERO_FACTS, INSTALL_CMD } from "./content";
import { DeployRail } from "./deploy-rail";
import {
  CommandLine,
  Container,
  Field,
  OutlineButton,
  PrimaryButton,
  StateChip,
} from "./primitives";

/**
 * A centred hero: one claim at display scale, everything else stacked under
 * it on the page's axis, then the deploy rail running full width as a product
 * shot. Symmetry is the point — the page opens like a title card, and the
 * first thing that breaks the axis is the product itself.
 *
 * No entrance choreography on the copy. The one thing that moves is the rail,
 * because it depicts something that moves.
 */
export function Hero() {
  return (
    <header className="relative overflow-hidden">
      {/* Dot-grid texture, masked away before it reaches any text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 70% 42% at 50% 0%, #000, transparent 74%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 42% at 50% 0%, #000, transparent 74%)",
        }}
      />

      <Container className="relative flex flex-col items-center pt-32 pb-12 text-center lg:pt-36">
        <StateChip tone="warning">pre-1.0 · under active development</StateChip>

        <h1
          className="mt-7 max-w-[16ch] font-semibold text-balance"
          style={{
            fontSize: "clamp(2.6rem, 5.6vw, 4.25rem)",
            lineHeight: 1.03,
            letterSpacing: "-0.045em",
          }}
        >
          Push to git. Deploy to <span className="text-primary">your own servers.</span>
        </h1>

        <p className="mt-6 max-w-[54ch] text-[1.0625rem] leading-relaxed text-pretty text-muted-foreground">
          A deployment platform that runs on your hardware. Builds from a repo, managed databases,
          automatic HTTPS, previews on every pull request. Self-hosted, open source, no usage bill.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <PrimaryButton href="/docs/start/first-deploy">
            Get started
            <HugeiconsIcon icon={ArrowRight01Icon} />
          </PrimaryButton>
          <OutlineButton href={GITHUB_URL} target="_blank" rel="noreferrer">
            <HugeiconsIcon icon={GithubIcon} />
            Read the source
          </OutlineButton>
        </div>

        <div className="mt-9 w-full max-w-[38rem] min-w-0">
          <p className="mb-2 font-mono text-[0.7rem] text-muted-foreground">
            or run it on a box you already own
          </p>
          <CommandLine command={INSTALL_CMD} />
        </div>
      </Container>

      <Container className="relative pb-16 lg:pb-20">
        <Field>
          <div className="mx-auto max-w-[64rem]">
            <DeployRail />
          </div>
        </Field>

        <ul className="mx-auto mt-10 grid max-w-[52rem] grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          {HERO_FACTS.map((fact) => (
            <li key={fact.label} className="text-center">
              <span className="block text-[1.5rem] leading-none font-semibold tracking-tight tabular-nums">
                {fact.value}
              </span>
              <span className="mt-1.5 block text-[0.75rem] leading-snug text-muted-foreground">
                {fact.label}
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </header>
  );
}
