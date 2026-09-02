import { type RefObject, useEffect, useRef, useState } from "react";

import { OtterdeployMark } from "@/components/brand/otterdeploy-mark";

import { Band, Container, cx, Mono } from "../landing/primitives";
import { Reveal } from "./reveal";

/**
 * The "what a pull request buys you" chapter — the three capabilities the
 * comparison table marks as ours alone, shown, not listed.
 *
 * The comment card reproduces the REAL sticky PR comment the platform posts
 * (packages/api/src/git/preview-comment.ts): the bold status line, the
 * Service/Status/Preview/Updated table, the "Deploying commit" footer. When
 * the card scrolls into view the web row runs Building → Ready and the
 * preview link appears, the way the bot edits its own comment. Reduced
 * motion renders the finished state.
 */

function useInView(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

function StatusDot({ tone }: { tone: "green" | "orange" }) {
  return (
    <span
      className={cx(
        "inline-block size-2 rounded-full",
        tone === "green" ? "bg-[#3fb950]" : "bg-[#d29922]",
      )}
    />
  );
}

function BotComment() {
  const [ref, inView] = useInView();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReady(true);
      return;
    }
    const id = setTimeout(() => setReady(true), 1600);
    return () => clearTimeout(id);
  }, [inView]);

  const th = "px-3 py-2 text-left font-medium text-white/50";
  const td = "border-t border-white/[0.08] px-3 py-2.5";

  return (
    <div
      ref={ref}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/[0.12] bg-[#0d1117]"
    >
      {/* Comment header, the way GitHub draws it */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.08] bg-white/[0.03] px-4 py-3">
        <span className="grid size-6 place-items-center rounded-full bg-[#3d7bfb]/15 ring-1 ring-[#3d7bfb]/30">
          <OtterdeployMark size={13} />
        </span>
        <span className="text-[0.8125rem] font-semibold text-white/90">otterdeploy</span>
        <span className="rounded-full border border-white/[0.15] px-1.5 py-px text-[0.625rem] leading-4 text-white/55">
          bot
        </span>
        <span className="text-[0.75rem] text-white/40">
          commented · {ready ? "just now" : "now"}
        </span>
      </div>

      <div className="px-4 py-4">
        <p className="text-[0.875rem] font-semibold text-white/90">
          The latest updates on your preview environment.
        </p>

        <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.08]">
          <table className="w-full border-collapse text-[0.8125rem]">
            <thead>
              <tr className="bg-white/[0.03]">
                <th className={th}>Service</th>
                <th className={th}>Status</th>
                <th className={th}>Preview</th>
                <th className={cx(th, "hidden sm:table-cell")}>Updated (UTC)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cx(td, "font-semibold text-white/85")}>web</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <StatusDot tone={ready ? "green" : "orange"} />
                    <span className={ready ? "text-white/85" : "text-[#d29922]"}>
                      {ready ? "Ready" : "Building"}
                    </span>
                    <span className="text-white/35">
                      (<span className="text-[#58a6ff]">Inspect</span>)
                    </span>
                  </span>
                </td>
                <td className={td}>
                  <span
                    className={cx(
                      "whitespace-nowrap text-[#58a6ff] transition-opacity duration-500",
                      ready ? "opacity-100" : "opacity-0",
                    )}
                  >
                    Visit Preview
                  </span>
                </td>
                <td className={cx(td, "hidden whitespace-nowrap text-white/45 sm:table-cell")}>
                  Sep 2, 2026 4:12am
                </td>
              </tr>
              <tr>
                <td className={cx(td, "font-semibold text-white/85")}>api</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <StatusDot tone="green" />
                    <span className="text-white/85">Ready</span>
                    <span className="text-white/35">
                      (<span className="text-[#58a6ff]">Inspect</span>)
                    </span>
                  </span>
                </td>
                <td className={td}>
                  <span className="whitespace-nowrap text-[#58a6ff]">Visit Preview</span>
                </td>
                <td className={cx(td, "hidden whitespace-nowrap text-white/45 sm:table-cell")}>
                  Sep 2, 2026 4:11am
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[0.75rem] text-white/40">
          Deploying commit <span className="font-mono text-white/60">9f31c2e</span> · otterdeploy
          updates this comment as deployments progress.
        </p>
      </div>

      {/* The commit status the writeback sets on the head SHA */}
      <div className="mt-auto flex items-center gap-2 border-t border-white/[0.08] bg-white/[0.02] px-4 py-2.5">
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 16 16"
          className={cx(
            "fill-none transition-colors",
            ready ? "stroke-[#3fb950]" : "stroke-[#d29922]",
          )}
        >
          {ready ? (
            <path
              d="M3 8.4l3.3 3.3L13 4.6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <circle cx="8" cy="8" r="5.5" strokeWidth="2" />
          )}
        </svg>
        <span className="text-[0.75rem] text-white/60">
          <span className="font-medium text-white/80">otterdeploy</span> —{" "}
          {ready ? "Preview ready" : "Building preview…"}
        </span>
      </div>
    </div>
  );
}

/** One resource in the preview graph: a rail dot + a node chip. */
function GraphNode({
  name,
  kind,
  tone,
}: {
  name: string;
  kind: string;
  tone: "service" | "branch";
}) {
  const branch = tone === "branch";
  return (
    <div className="relative flex items-center gap-3">
      <span
        className={cx(
          "relative z-10 size-2.5 shrink-0 rounded-full ring-4 ring-[#0c0d0e]",
          branch ? "bg-[#3d7bfb]" : "bg-[#3fb950]",
        )}
      />
      <div
        className={cx(
          "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2",
          branch ? "border-[#3d7bfb]/30 bg-[#3d7bfb]/[0.07]" : "border-white/[0.1] bg-[#0f1011]",
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <Mono className={branch ? "text-[#7ab5ff]" : "text-white/85"}>{name}</Mono>
          {branch && (
            <span className="rounded border border-[#3d7bfb]/30 px-1 py-px font-mono text-[0.625rem] text-[#7ab5ff]">
              branch
            </span>
          )}
        </span>
        <span className="shrink-0 text-[0.6875rem] text-white/40">{kind}</span>
      </div>
    </div>
  );
}

function PreviewGraph() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-[#0c0d0e] p-5">
      {/* The project graph's own dotted canvas, faint. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          maskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, #000, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, #000, transparent 78%)",
        }}
      />
      <div className="relative flex items-center justify-between">
        <h3 className="text-[0.9375rem] font-semibold text-white/90">Preview environment</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3d7bfb]/30 bg-[#3d7bfb]/[0.08] px-2 py-0.5">
          <span aria-hidden className="size-1.5 rounded-full bg-[#3d7bfb]" />
          <Mono className="text-[#7ab5ff]">pr-482</Mono>
        </span>
      </div>

      {/* The PR's resources, on the graph's rail. */}
      <div className="relative mt-4">
        <span aria-hidden className="absolute top-3 bottom-3 left-[4.5px] w-px bg-white/[0.12]" />
        <div className="flex flex-col gap-2.5">
          <GraphNode name="web" kind="service · running" tone="service" />
          <GraphNode name="api" kind="service · running" tone="service" />
          <GraphNode name="postgres" kind="branched from production" tone="branch" />
        </div>
      </div>

      <p className="relative mt-auto pt-4 text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
        The whole preview is one graph — services and a branched database. The preview's{" "}
        <Mono className="text-foreground/70">{"${{db.DATABASE_URL}}"}</Mono> resolves to{" "}
        <span className="text-[#7ab5ff]">pr-482</span>, so production data is never touched.
      </p>
    </div>
  );
}

const WALLS = ["Org login", "Access PIN", "Share link", "Guest invite", "CI bypass token"];

function WallCard() {
  return (
    <div className="rounded-xl border border-border bg-white/[0.012] p-5 md:flex md:items-center md:gap-8 md:p-6">
      <div className="md:max-w-[24rem] md:shrink-0">
        <h3 className="text-[0.9375rem] font-semibold text-foreground">A wall in front of it</h3>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
          One toggle puts deployment protection in front of any route — Caddy gates it with
          forward-auth and a wall page. No basic-auth headers, no code changes, and a scoped bypass
          token keeps your CI green.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 md:mt-0">
        {WALLS.map((w) => (
          <span
            key={w}
            className="rounded-full border border-border px-2.5 py-1 text-[0.75rem] text-foreground/80"
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PrPreview() {
  return (
    <Band id="previews">
      <Container className="py-20 lg:py-28">
        <Reveal className="max-w-[46rem]">
          <Mono className="text-muted-foreground/70">PULL REQUESTS · ONLY OTTERDEPLOY</Mono>
          <h2 className="mt-3 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">
            Open a pull request. Get an environment.
          </h2>
          <p className="mt-4 max-w-[56ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
            The platform builds the branch, comments the preview URLs on the PR, and flips the
            commit status when everything is live — with a branched database and a lock on the door
            if you want them.
          </p>
        </Reveal>

        <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-2">
          <Reveal delay={80} className="flex">
            <BotComment />
          </Reveal>
          <Reveal delay={160} className="flex">
            <PreviewGraph />
          </Reveal>
        </div>
        <Reveal delay={200}>
          <p className="mt-4 px-1 text-[0.75rem] text-muted-foreground/70">
            Merged or closed? Containers, preview hosts and branched databases are removed.
          </p>
        </Reveal>
        <Reveal delay={260} className="mt-5">
          <WallCard />
        </Reveal>
      </Container>
    </Band>
  );
}
