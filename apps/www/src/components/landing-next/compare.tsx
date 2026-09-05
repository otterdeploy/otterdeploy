import type { ReactNode } from "react";

import { COMPARE_COLUMNS, COMPARE_ROWS, type CompareMark } from "../landing/content";
import { Container, cx, Mono } from "../landing/primitives";
import { CompareMethodology } from "./compare-methodology";
import { Reveal } from "./reveal";

/**
 * The competitor matrix, on Klarna's "How we compare" pattern: an icon on every
 * capability row, our column lifted as one continuous highlighted stripe, and
 * the same framed container the "manual way" table above it uses, so the two
 * read as one chapter. Responsive by design: the grid on desktop, a stack of
 * compact cards on mobile (never a horizontal scroll). Kamal is dropped on this
 * page; the shared data keeps all columns for the current landing.
 */

// Columns shown here (drop the trailing Kamal column without touching the
// shared source). Index 0 is always otterdeploy.
const COLUMNS = COMPARE_COLUMNS.slice(0, 4);
const KEPT = COLUMNS.length;

const I = (d: ReactNode) => (
  <svg
    aria-hidden
    width="15"
    height="15"
    viewBox="0 0 16 16"
    className="shrink-0 fill-none stroke-current"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d}
  </svg>
);

/** One small line icon per row, in COMPARE_ROWS order. */
const ROW_ICONS: ReactNode[] = [
  I(
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M6 6v7.5" />
    </>,
  ),
  I(
    <>
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M4 5.6v4.8M12 10.4V8.6a3 3 0 0 0-3-3H7" />
    </>,
  ),
  I(
    <>
      <ellipse cx="6" cy="4" rx="4" ry="1.7" />
      <path d="M2 4v5c0 .9 1.8 1.7 4 1.7M10 8.5v5M10 8.5l2 2M10 8.5l-2 2" />
    </>,
  ),
  I(
    <>
      <ellipse cx="8" cy="4" rx="5.2" ry="1.9" />
      <path d="M2.8 4v8c0 1 2.3 1.9 5.2 1.9s5.2-.9 5.2-1.9V4M2.8 8c0 1 2.3 1.9 5.2 1.9S13.2 9 13.2 8" />
    </>,
  ),
  I(
    <>
      <path d="M8 2l4.5 1.7v3.5c0 3-2 4.9-4.5 5.8-2.5-.9-4.5-2.8-4.5-5.8V3.7z" />
      <path d="M8 6v4M6 8l2 2 2-2" />
    </>,
  ),
  I(<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 3v3h-3" />),
  I(
    <>
      <rect x="2" y="2.5" width="12" height="4" rx="1" />
      <rect x="2" y="9.5" width="12" height="4" rx="1" />
      <path d="M4.5 4.5h.01M4.5 11.5h.01" />
    </>,
  ),
  I(
    <>
      <path d="M8 1.8l6 3-6 3-6-3z" />
      <path d="M2 8l6 3 6-3M2 11l6 3 6-3" />
    </>,
  ),
  I(<path d="M6 5L3 8l3 3M10 5l3 3-3 3" />),
  I(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2.4 2.8 2.4 9.2 0 12M8 2C5.6 4.8 5.6 11.2 8 14" />
    </>,
  ),
  I(
    <>
      <path d="M8 1.8l5 1.9v4c0 3.2-2 5.4-5 6.3-3-.9-5-3.1-5-6.3v-4z" />
      <path d="M5.7 8l1.6 1.6L10.3 6.5" />
    </>,
  ),
];

function Mark({ mark, col }: { mark: CompareMark; col: string }) {
  const label = { yes: "Yes", partial: "Partial", no: "No" }[mark];
  return (
    <span
      className="inline-grid size-5 place-items-center"
      role="img"
      aria-label={`${col}: ${label}`}
    >
      {mark === "yes" ? (
        <svg width="15" height="15" viewBox="0 0 16 16" className="fill-none stroke-[#3d7bfb]">
          <path
            d="M3 8.4l3.3 3.3L13 4.6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : mark === "partial" ? (
        <span className="size-2.5 rounded-full border-[1.5px] border-white/30" />
      ) : (
        <span className="h-[1.5px] w-2.5 rounded-full bg-white/18" />
      )}
    </span>
  );
}

/** grid-template-columns shared by header and every row (desktop). */
const COLS = "grid-cols-[20rem_repeat(4,minmax(0,1fr))]";
/** Left/width of the highlighted otterdeploy column (first data column). */
const STRIPE = { left: "20rem", width: "calc((100% - 20rem) / 4)" } as const;

export function CompareBlock() {
  return (
    <Container className="pt-20 pb-20 lg:pt-24 lg:pb-28">
      <Reveal className="max-w-[46rem]">
        <Mono className="text-muted-foreground">OTTERDEPLOY vs THE ALTERNATIVES</Mono>
        <h2 className="mt-3 text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[2.25rem]">
          How it compares
        </h2>
        <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
          The table you'd have opened in another tab anyway. Wins conceded where they're due. A
          hollow ring means it exists with wiring or caveats; where we weren't sure, the mark went
          to the other tool.
        </p>
      </Reveal>

      {/* Desktop: the framed matrix */}
      <Reveal delay={100} className="mt-10 hidden lg:block">
        <div className="relative overflow-hidden rounded-2xl border border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 bg-[#3d7bfb]/[0.07] shadow-[inset_1px_0_0_rgba(61,123,251,0.22),inset_-1px_0_0_rgba(61,123,251,0.22)]"
            style={STRIPE}
          />

          <div className={cx("relative grid border-b border-border bg-white/[0.025]", COLS)}>
            <div />
            {COLUMNS.map((col, i) => (
              <div key={col} className="px-3 py-4 text-center">
                <span
                  className={cx(
                    "text-[0.8125rem] font-semibold tracking-tight",
                    i === 0 ? "text-[#7ab5ff]" : "text-foreground/80",
                  )}
                >
                  {col}
                </span>
              </div>
            ))}
          </div>

          <div className="relative">
            {COMPARE_ROWS.map((row, r) => (
              <div
                key={row.label}
                className={cx(
                  "grid items-center border-t border-border/60",
                  COLS,
                  r % 2 === 1 && "bg-white/[0.012]",
                )}
              >
                <div className="flex items-center gap-3 py-3.5 pr-4 pl-5 text-[0.8125rem] text-foreground/90">
                  <span className="text-muted-foreground/60">{ROW_ICONS[r]}</span>
                  <span className="truncate">{row.label}</span>
                </div>
                {row.marks.slice(0, KEPT).map((mark, i) => (
                  <div key={COLUMNS[i]} className="flex justify-center py-3.5">
                    <Mark mark={mark} col={COLUMNS[i]} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Mobile: reinvented, not a shrunk matrix. Every capability ships in
          otterdeploy (one check); the sub-line names who ELSE has it, with the
          differentiators called out in accent. One compact row each — the
          "where the others fall short" story, no repetition. */}
      <Reveal delay={100} className="mt-8 lg:hidden">
        <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-white/[0.012]">
          {COMPARE_ROWS.map((row, r) => {
            const competitors = COLUMNS.slice(1);
            const also = competitors.filter((_, i) => row.marks[i + 1] === "yes");
            const partial = competitors.filter((_, i) => row.marks[i + 1] === "partial");
            const unique = also.length === 0 && partial.length === 0;
            return (
              <div key={row.label} className="flex items-center gap-3.5 px-4 py-3.5">
                <span className="shrink-0 text-muted-foreground/55">{ROW_ICONS[r]}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[0.875rem] font-medium text-foreground">{row.label}</div>
                  <div className="mt-0.5 text-[0.75rem] leading-snug">
                    {unique ? (
                      <span className="font-medium text-[#7ab5ff]">Built into otterdeploy</span>
                    ) : (
                      <span className="text-muted-foreground">
                        Also in {also.join(", ")}
                        {partial.length > 0 && (
                          <span className="text-muted-foreground">
                            {also.length > 0 ? " · " : ""}partial in {partial.join(", ")}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  aria-hidden
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  className="shrink-0 fill-none stroke-[#3d7bfb]"
                >
                  <path
                    d="M3 8.4l3.3 3.3L13 4.6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            );
          })}
        </div>
        <p className="mt-3 px-1 text-[0.75rem] leading-relaxed text-muted-foreground">
          Every capability above ships in otterdeploy. The note shows which competitors also have
          it.
        </p>
      </Reveal>

      <CompareMethodology />
    </Container>
  );
}
