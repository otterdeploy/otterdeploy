import type { ReactNode } from "react";

import { Band, Container, cx, Field } from "./primitives";
import { BuildVisual } from "./visuals-deploy";
import { EnvVisual, PreviewVisual, RoutesVisual } from "./visuals-platform";
import { ProjectVisual } from "./visuals-project";

/**
 * The feature showcase: four panels, each one claim with the interface that
 * backs it up. Panels alternate sides so the eye zig-zags down the page
 * instead of scanning one column, and the visual is always the larger half —
 * this is the part of the page that has to show rather than tell.
 */

interface PanelProps {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
  /** Visual on the left instead of the right. */
  flip?: boolean;
  tone?: "canvas" | "ink";
}

function Panel({ id, eyebrow, title, body, points, visual, flip, tone }: PanelProps) {
  return (
    <Band id={id} tone={tone}>
      <Container className="py-16 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
          <div className={cx("min-w-0 max-w-[34rem]", flip && "lg:order-2")}>
            <span className="font-mono text-[0.75rem] text-muted-foreground">{eyebrow}</span>
            <h2 className="mt-3 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.025em] text-balance sm:text-[1.875rem]">
              {title}
            </h2>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
              {body}
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-2 gap-y-2">
              {points.map((point) => (
                <li
                  key={point}
                  className="rounded-full border border-border px-3 py-1 text-[0.75rem] text-foreground"
                >
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className={cx("min-w-0", flip && "lg:order-1")}>
            <Field>{visual}</Field>
          </div>
        </div>
      </Container>
    </Band>
  );
}

export function Showcase() {
  return (
    <>
      <Panel
        id="deploy"
        eyebrow="deploy"
        title="Connect a repo. Push. That's the deploy."
        body="The repo is inspected, the framework is detected, and Railpack builds it — no Dockerfile to write and keep current, though it'll use yours if there is one. The image rolls out as a Swarm service, the old one drains, and the whole thing is one log you can watch."
        points={["Next.js, Astro, Go, Rust, static", "Dockerfile when you want it", "Rollback to any build"]}
        visual={<BuildVisual />}
      />

      <Panel
        id="project"
        eyebrow="projects"
        title="Your services, drawn the way you think about them"
        body="A project is a canvas: services, databases and compose stacks, with the wiring between them visible. Click a node for its logs, metrics, variables and domains — no hunting through tabs to find out what's actually running."
        points={["Live status per node", "Compose stacks as one resource", "Templates to start from"]}
        visual={<ProjectVisual />}
        flip
      />

      <Panel
        id="edge"
        eyebrow="edge"
        title="Domains that tell you the truth"
        body="Point a domain at your box and the Caddy edge picks it up, issues the certificate and starts routing. When something isn't right, it says which part — the DNS hasn't propagated, or the certificate is still being issued."
        points={["Automatic HTTPS", "Multi-domain routing", "Password-wall a deployment"]}
        visual={<RoutesVisual />}
      />

      <Panel
        id="data"
        eyebrow="data"
        title="Databases your services can just ask for"
        body="Provision Postgres, Redis, MariaDB, MongoDB or ClickHouse next to the app that needs it. Reference it by name and the connection string is filled in at deploy — nothing copied, nothing to rotate by hand. Secrets can be sealed so even the API won't read them back."
        points={["Five engines", "Encrypted backups", "Restore to any snapshot"]}
        visual={<EnvVisual />}
        flip
      />

      <Panel
        id="previews"
        eyebrow="previews"
        title="Every pull request gets its own URL"
        body="Open a PR and it comes up on its own deployment, with its own database copy if you want one. The link goes on the pull request. Close it and everything is torn down — and anything left idle is reaped without you remembering to."
        points={["Per-PR deployments", "Optional database branching", "Automatic teardown"]}
        visual={<PreviewVisual />}
      />
    </>
  );
}
