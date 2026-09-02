import { Container, cx, Mono } from "../landing/primitives";
import { CONTRASTS, type Contrast } from "./content";
import { Reveal } from "./reveal";

/**
 * "By hand vs otterdeploy" — V7's before/with pattern, made honest. Each row
 * is one job: what a self-hoster does today (struck through), and the one-line
 * version. The otterdeploy column is a continuous highlighted stripe, so the
 * eye reads the payoff down the right edge. Rendered as a block inside the
 * shared comparison chapter, framed identically to the competitor matrix.
 */

function Row({ c, last }: { c: Contrast; last: boolean }) {
  const cell = cx(
    "flex items-center bg-background px-5 py-5",
    !last && "border-b border-border sm:border-b-0",
  );
  return (
    <div className="grid items-stretch gap-px sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className={cell}>
        <span className="text-[0.9375rem] font-medium text-foreground">{c.task}</span>
      </div>
      <div className={cell}>
        <span className="text-[0.875rem] leading-relaxed text-pretty text-muted-foreground/75 line-through decoration-white/15">
          {c.hand}
        </span>
      </div>
      <div className="relative flex items-center bg-[#3d7bfb]/[0.06] px-5 py-5 shadow-[inset_1px_0_0_rgba(61,123,251,0.22),inset_-1px_0_0_rgba(61,123,251,0.22)]">
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 16 16"
          className="mr-2.5 shrink-0 fill-none stroke-[#3d7bfb]"
        >
          <path
            d="M3 8.4l3.3 3.3L13 4.6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[0.875rem] leading-relaxed text-pretty text-foreground">{c.od}</span>
      </div>
    </div>
  );
}

export function ContrastBlock() {
  return (
    <Container className="pt-20 pb-0 lg:pt-28">
      <Reveal className="max-w-[44rem]">
        <Mono className="text-muted-foreground/70">BY HAND vs OTTERDEPLOY</Mono>
        <h2 className="mt-3 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">
          The manual way, retired
        </h2>
        <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
          Everything you'd wire together on a bare box — the platform already did. The left column
          is the afternoon you spend today; the right is one line.
        </p>
      </Reveal>

      <Reveal delay={100}>
        <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-border">
          <div className="grid gap-px sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="bg-background px-5 py-3" />
            <div className="bg-background px-5 py-3">
              <Mono className="text-muted-foreground/70">by hand</Mono>
            </div>
            <div className="bg-[#3d7bfb]/[0.1] px-5 py-3 shadow-[inset_1px_0_0_rgba(61,123,251,0.22),inset_-1px_0_0_rgba(61,123,251,0.22)]">
              <Mono className="font-medium text-[#7ab5ff]">with otterdeploy</Mono>
            </div>
          </div>
          {CONTRASTS.map((c, i) => (
            <div key={c.task} className="border-t border-border">
              <Row c={c} last={i === CONTRASTS.length - 1} />
            </div>
          ))}
        </div>
      </Reveal>
    </Container>
  );
}
