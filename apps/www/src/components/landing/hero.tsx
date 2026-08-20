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
 * The hero, asymmetric: the claim owns the left as display type with the one
 * accent phrase, and everything actionable stacks on the right — copy, CTAs,
 * the install command. Below the fold-line, the deploy rail runs full width,
 * a product shot rather than a sidebar illustration.
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
          maskImage: "radial-gradient(ellipse 75% 45% at 50% 0%, #000, transparent 72%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 45% at 50% 0%, #000, transparent 72%)",
        }}
      />

      <Container className="relative grid gap-10 pt-16 pb-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end lg:gap-20 lg:pt-24 lg:pb-14">
        <div className="min-w-0">
          <StateChip tone="warning">pre-1.0 · under active development</StateChip>

          <h1
            className="mt-7 max-w-[13ch] font-semibold text-balance"
            style={{
              fontSize: "clamp(2.7rem, 5.6vw, 4.25rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
            }}
          >
            Push to git. Deploy to <span className="text-primary">your own servers.</span>
          </h1>
        </div>

        {/* `min-w-0` is load-bearing: the install command below sets
            `whitespace-nowrap`, and a grid item's default `min-width: auto`
            would let that one line widen the whole column past the viewport. */}
        <div className="flex min-w-0 flex-col gap-6 lg:pb-1.5">
          <p className="max-w-[46ch] text-[1rem] leading-relaxed text-pretty text-muted-foreground">
            A deployment platform that runs on your hardware. Builds from a repo, managed databases,
            automatic HTTPS, previews on every pull request. Self-hosted, open source, no usage
            bill.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton href="/docs/start/first-deploy">
              Get started
              <HugeiconsIcon icon={ArrowRight01Icon} />
            </PrimaryButton>
            <OutlineButton href={GITHUB_URL} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={GithubIcon} />
              Read the source
            </OutlineButton>
          </div>

          <div className="min-w-0">
            <p className="mb-2 font-mono text-[0.7rem] text-muted-foreground">
              or run it on a box you already own
            </p>
            <CommandLine command={INSTALL_CMD} />
          </div>
        </div>
      </Container>

      <Container className="relative pb-14 lg:pb-16">
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
