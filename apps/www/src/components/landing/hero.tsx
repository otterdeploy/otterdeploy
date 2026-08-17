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
 * The hero states the job in one sentence and then shows it: the claim on the
 * left, the deploy rail on the right actually making it.
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
          maskImage: "radial-gradient(ellipse 70% 55% at 88% 18%, #000, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 88% 18%, #000, transparent 70%)",
        }}
      />

      <Container className="relative grid gap-12 pt-14 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16 lg:pt-20 lg:pb-20">
        {/* `min-w-0` is load-bearing: the install command below sets
            `whitespace-nowrap`, and a grid item's default `min-width: auto`
            would let that one line widen the whole column past the viewport. */}
        <div className="max-w-[34rem] min-w-0">
          <StateChip tone="warning">pre-1.0 · under active development</StateChip>

          <h1
            className="mt-6 font-semibold text-balance"
            style={{
              fontSize: "clamp(2.35rem, 4.6vw, 3.35rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
            }}
          >
            Push to git.
            <br />
            Deploy to your own servers.
          </h1>

          <p className="mt-6 max-w-[44ch] text-[1.0625rem] leading-relaxed text-pretty text-muted-foreground">
            A deployment platform that runs on your hardware. Builds from a repo, managed databases,
            automatic HTTPS, previews on every pull request. Self-hosted, open source, no usage
            bill.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryButton href="/docs/start/first-deploy">
              Get started
              <HugeiconsIcon icon={ArrowRight01Icon} />
            </PrimaryButton>
            <OutlineButton href={GITHUB_URL} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={GithubIcon} />
              Read the source
            </OutlineButton>
          </div>

          <CommandLine className="mt-7" command={INSTALL_CMD} />

          <ul className="mt-9 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-7 sm:grid-cols-4">
            {HERO_FACTS.map((fact) => (
              <li key={fact.label}>
                <span className="block text-[1.375rem] leading-none font-semibold tracking-tight tabular-nums">
                  {fact.value}
                </span>
                <span className="mt-1.5 block text-[0.75rem] leading-snug text-muted-foreground">
                  {fact.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 lg:pl-4">
          <Field>
            <DeployRail />
          </Field>
        </div>
      </Container>
    </header>
  );
}
