import type { ReactNode } from "react";

import { Band, Container, cx, TwoTone } from "./primitives";
import { BuildVisual } from "./visuals-deploy";
import { EnvVisual, PreviewVisual, RoutesVisual } from "./visuals-platform";
import { ProjectVisual } from "./visuals-project";

/**
 * The feature showcase as a bento: five cards, each a real product shot with
 * one claim under it. The shot sits on the warm-ink field so it reads as a
 * screen; the words sit on the card so they read as a caption. Two wide cards
 * carry the two biggest ideas, three narrow ones fill in the rest — a single
 * calm grid instead of five alternating bands.
 *
 * The whole grid is one section (`#features`). The per-panel ids this used to
 * carry are gone, which is why NAV_SECTIONS no longer lists them.
 */

interface CardProps {
  title: string;
  body: string;
  visual: ReactNode;
  /** Spans three of six columns instead of two. */
  wide?: boolean;
}

const CARDS: CardProps[] = [
  {
    title: "Connect a GitHub repo. Push. That's the deploy.",
    body: "The GitHub repo is inspected, the framework detected, and Railpack builds it — no Dockerfile to keep current, though yours is used if present. The image rolls out as a Swarm service and the whole thing is one log you can watch.",
    visual: <BuildVisual />,
    wide: true,
  },
  {
    title: "Your services, drawn the way you think about them",
    body: "A project is a canvas: services, databases and compose stacks with the wiring visible. Click a node for its logs, metrics, variables and domains.",
    visual: <ProjectVisual />,
    wide: true,
  },
  {
    title: "Custom domains and automatic HTTPS that tell you the truth",
    body: "Point a domain at your server and the Caddy edge picks it up, issues the certificate and starts routing. When it isn't ready yet, the route says which part: DNS still unpointed, or a certificate still obtaining.",
    visual: <RoutesVisual />,
  },
  {
    title: "Managed Postgres, Redis and MongoDB your services just ask for",
    body: "Five engines, provisioned next to the app. Reference one by name and the connection string is filled in at deploy — secrets can be sealed.",
    visual: <EnvVisual />,
  },
  {
    title: "Every pull request gets its own preview environment",
    body: "A PR comes up as its own preview environment, with its own database copy if you want one. Close it and everything is torn down.",
    visual: <PreviewVisual />,
  },
];

function Card({ title, body, visual, wide }: CardProps) {
  return (
    <article
      className={cx(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card",
        wide ? "lg:col-span-3" : "lg:col-span-2",
      )}
    >
      <div className="od-field min-w-0 p-4 sm:p-6">{visual}</div>
      <div className="flex flex-1 flex-col gap-2 p-5 sm:p-6">
        <h3 className="text-[1.0625rem] leading-snug font-semibold tracking-[-0.015em] text-balance">
          {title}
        </h3>
        <p className="text-[0.875rem] leading-relaxed text-pretty text-muted-foreground">{body}</p>
      </div>
    </article>
  );
}

export function Showcase() {
  return (
    <Band id="features">
      <Container className="py-16 lg:py-20">
        <div className="mx-auto max-w-[46rem] text-center">
          <TwoTone a="Everything a deploy needs." b="Shown, not listed." />
          <p className="mx-auto mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            Each card is the actual interface, not an illustration of one. The deep reference lives
            in the docs, one click away.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-6">
          {CARDS.map((card) => (
            <Card key={card.title} {...card} />
          ))}
        </div>
      </Container>
    </Band>
  );
}
