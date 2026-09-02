import type { ComponentType, SVGProps } from "react";

import { OtterdeployMark } from "@/components/brand/otterdeploy-mark";
import { Bitbucket } from "@/components/brand/svgs/bitbucket";
import { Discord } from "@/components/brand/svgs/discord";
import { Docker } from "@/components/brand/svgs/docker";
import { Doppler } from "@/components/brand/svgs/doppler";
import { Forgejo } from "@/components/brand/svgs/forgejo";
import { Gitea } from "@/components/brand/svgs/gitea";
import { Github } from "@/components/brand/svgs/github";
import { Gitlab } from "@/components/brand/svgs/gitlab";
import { Harbor } from "@/components/brand/svgs/harbor";
import { Infisical } from "@/components/brand/svgs/infisical";
import { NetBird } from "@/components/brand/svgs/netbird";
import { Pagerduty } from "@/components/brand/svgs/pagerduty";
import { Slack } from "@/components/brand/svgs/slack";
import { Tailscale } from "@/components/brand/svgs/tailscale";
import { Vault } from "@/components/brand/svgs/vault";

import { Band, Container, Mono } from "../landing/primitives";
import { INTEGRATIONS, type IntegrationLogo } from "./content";
import { Reveal } from "./reveal";

/**
 * The orchestrator. otterdeploy sits in the middle; the tools you already run
 * wire into it, and a pulse of light flows down every wire toward the core —
 * the feeling that these plug into one hand that conducts them, not that you
 * migrate onto yet another platform.
 *
 * The stage is a fixed 1000x560 space; tiles are positioned by percentage and
 * the wires drawn in the same coordinates, so the whole thing scales as one.
 * Below lg it falls back to plain grouped rows (a hub is unreadable at phone
 * width). The flow animation is gated on `prefers-reduced-motion`.
 */

const LOGOS: Record<IntegrationLogo, ComponentType<SVGProps<SVGSVGElement>>> = {
  github: Github,
  gitlab: Gitlab,
  gitea: Gitea,
  forgejo: Forgejo,
  bitbucket: Bitbucket,
  infisical: Infisical,
  vault: Vault,
  doppler: Doppler,
  docker: Docker,
  harbor: Harbor,
  tailscale: Tailscale,
  netbird: NetBird,
  slack: Slack,
  discord: Discord,
  pagerduty: Pagerduty,
};

const HUB = { x: 500, y: 280 };
interface Spoke {
  logo: IntegrationLogo;
  x: number;
  y: number;
  side: "l" | "r";
}

/** Two columns of sources/targets, each wired into the core. */
const SPOKES: Spoke[] = [
  { logo: "github", x: 120, y: 60, side: "l" },
  { logo: "gitlab", x: 120, y: 148, side: "l" },
  { logo: "gitea", x: 120, y: 236, side: "l" },
  { logo: "infisical", x: 120, y: 324, side: "l" },
  { logo: "vault", x: 120, y: 412, side: "l" },
  { logo: "doppler", x: 120, y: 500, side: "l" },
  { logo: "docker", x: 880, y: 60, side: "r" },
  { logo: "harbor", x: 880, y: 148, side: "r" },
  { logo: "tailscale", x: 880, y: 236, side: "r" },
  { logo: "slack", x: 880, y: 324, side: "r" },
  { logo: "discord", x: 880, y: 412, side: "r" },
  { logo: "pagerduty", x: 880, y: 500, side: "r" },
];

/** A cubic from a tile into the core, landing on the hub's near edge. */
function wire({ x, y, side }: Spoke) {
  const edgeX = side === "l" ? HUB.x - 78 : HUB.x + 78;
  const endY = HUB.y + (y - HUB.y) * 0.12;
  const c1x = side === "l" ? x + 220 : x - 220;
  const c2x = side === "l" ? edgeX - 120 : edgeX + 120;
  return `M ${x} ${y} C ${c1x} ${y}, ${c2x} ${endY}, ${edgeX} ${endY}`;
}

function Hub() {
  return (
    <div className="relative mx-auto aspect-[1000/560] w-full max-w-[54rem]">
      <svg
        aria-hidden
        viewBox="0 0 1000 560"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        fill="none"
      >
        {SPOKES.map((s, i) => {
          const d = wire(s);
          return (
            <g key={s.logo}>
              <path
                d={d}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={d}
                pathLength={100}
                className="od-flow"
                stroke="#3d7bfb"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="7 93"
                vectorEffect="non-scaling-stroke"
                style={{ animationDelay: `${(i % 6) * 0.4 + (s.side === "r" ? 0.2 : 0)}s` }}
              />
            </g>
          );
        })}
      </svg>

      {/* Core */}
      <div
        className="absolute z-10 grid size-[7.5rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border border-white/15 bg-[#0c0d0e]"
        style={{
          left: "50%",
          top: `${(HUB.y / 560) * 100}%`,
          boxShadow: "0 0 0 1px rgba(61,123,251,0.25), 0 0 60px -10px rgba(61,123,251,0.55)",
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-2xl ring-1 ring-[#3d7bfb]/30 motion-safe:animate-[od-hubPulse_2.8s_ease-in-out_infinite]"
        />
        <OtterdeployMark size={34} status="deploying" />
        <Mono className="mt-2 text-[0.625rem] text-white/60">otterdeploy</Mono>
      </div>

      {/* Provider tiles */}
      {SPOKES.map((s) => {
        const Logo = LOGOS[s.logo];
        return (
          <div
            key={s.logo}
            title={s.logo}
            className="absolute z-10 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border border-white/10 bg-[#0f1011] text-white/90 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.9)]"
            style={{ left: `${(s.x / 1000) * 100}%`, top: `${(s.y / 560) * 100}%` }}
          >
            <Logo aria-label={s.logo} role="img" className="size-5" />
          </div>
        );
      })}
    </div>
  );
}

export function Integrations() {
  return (
    <Band>
      <Container className="py-20 lg:py-28">
        <Reveal className="mx-auto max-w-[42rem] text-center">
          <h2 className="text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.125rem]">
            One hand on the whole stack
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            otterdeploy orchestrates the tools you already run — your git host, your secret vault,
            your registry, your mesh. Plug them in; it conducts them.
          </p>
        </Reveal>

        {/* Desktop: the orchestrator hub. */}
        <Reveal delay={120} className="mt-10 hidden lg:block">
          <Hub />
          <div className="mx-auto mt-6 flex max-w-[46rem] flex-wrap items-center justify-center gap-x-8 gap-y-2">
            {INTEGRATIONS.map((g) => (
              <span key={g.title} className="flex items-center gap-2">
                <span aria-hidden className="size-1 rounded-full bg-[#3d7bfb]" />
                <Mono className="text-muted-foreground">{g.title}</Mono>
              </span>
            ))}
          </div>
        </Reveal>

        {/* Mobile / tablet: plain grouped rows. */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:hidden">
          {INTEGRATIONS.map((group) => (
            <div key={group.title} className="rounded-xl border border-border bg-card/60 p-6">
              <h3 className="text-[0.9375rem] font-medium text-foreground">{group.title}</h3>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                {group.body}
              </p>
              <ul className="mt-5 flex flex-wrap gap-2.5">
                {group.items.map((item) => {
                  const Logo = LOGOS[item.logo];
                  return (
                    <li
                      key={item.name}
                      title={item.name}
                      className="grid size-11 place-items-center rounded-lg border border-border bg-background text-foreground"
                    >
                      <Logo aria-label={item.name} role="img" className="size-5" />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </Band>
  );
}
