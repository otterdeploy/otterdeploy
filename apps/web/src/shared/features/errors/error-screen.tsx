import type { CSSProperties, ReactNode } from "react";

interface ErrorScreenProps {
  /** HTTP-style status code, shown as the hero numeral. */
  code: string;
  /** Accent theme — semantic per status code. */
  accent: "indigo" | "red";
  /** Small label above the numeral. */
  eyebrow: string;
  /** Headline. */
  title: string;
  /** Short tag shown in the bottom status line. */
  statusTag: string;
  /** Body copy. */
  message: ReactNode;
  /** Action buttons / links. */
  actions: ReactNode;
}

const ACCENTS = {
  indigo: { accent: "oklch(0.7 0.17 264)", glow: "oklch(0.7 0.17 264 / 0.26)" },
  red: {
    accent: "oklch(0.685 0.205 25)",
    glow: "oklch(0.685 0.205 25 / 0.26)",
  },
} as const;

/** Filled primary action — works on both `<a>` and `<button>`. */
export const errorBtnClass =
  "cursor-pointer border border-(--accent) bg-(--accent) px-6 py-[0.82rem] " +
  "font-mono text-[0.79rem] uppercase tracking-[0.05em] text-(--bg) no-underline " +
  "transition-colors hover:bg-transparent hover:text-(--accent)";

/** Secondary / ghost action. */
export const errorBackClass =
  "cursor-pointer border-0 border-b border-(--line2) bg-transparent pb-[3px] " +
  "font-mono text-[0.79rem] uppercase tracking-[0.05em] text-(--dim) no-underline " +
  "transition-colors hover:border-(--dim) hover:text-(--ink)";

/** Inline highlight for a path / URL inside the message. */
export const errorPathClass =
  "border-b border-(--accent) pb-px text-(--ink) [word-break:break-all]";

const reveal = "animate-error-rise motion-reduce:animate-none";

/**
 * Full-screen error screen in the Otterdeploy console aesthetic. Presentational
 * only — `NotFound` and `ServerError` wrap it with code-specific content.
 *
 * Styling is Tailwind utilities; the grid / glow / grain / reveal-keyframe live
 * as `@utility` + `@theme` definitions in `src/index.css`.
 */
export function ErrorScreen({
  code,
  accent,
  eyebrow,
  title,
  statusTag,
  message,
  actions,
}: ErrorScreenProps) {
  const rootStyle = {
    "--bg": "#0a0b0d",
    "--ink": "#e7e8ec",
    "--dim": "#8b8d95",
    "--faint": "#4b4c54",
    "--line": "rgba(231,232,236,0.07)",
    "--line2": "rgba(231,232,236,0.16)",
    "--accent": ACCENTS[accent].accent,
    "--glow": ACCENTS[accent].glow,
  } as CSSProperties;

  return (
    <div
      style={rootStyle}
      className="fixed inset-0 z-60 overflow-auto bg-(--bg) font-mono text-[clamp(13px,1.4vmin,17px)] text-(--ink) antialiased"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 error-grid" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 error-glow" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] error-grain opacity-[0.04]"
      />

      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-3.5 left-3.5 z-[3] size-3.5 border-t border-l border-(--line2)"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-3.5 right-3.5 z-3 size-3.5 border-t border-r border-(--line2)"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3.5 left-3.5 z-3 size-3.5 border-b border-l border-(--line2)"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 bottom-3.5 z-3 size-3.5 border-r border-b border-(--line2)"
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-3 flex justify-between px-8 py-6 text-[0.72rem] tracking-[0.16em] text-(--dim) uppercase">
        <span>
          <span className="text-(--accent)">◆</span> OTTERDEPLOY
        </span>
        <span>
          ERR / <b className="font-normal text-(--ink)">{code}</b>
        </span>
      </header>

      <main className="relative z-2 flex min-h-full items-center justify-center px-[8vw] py-[11vh]">
        <div className="w-full max-w-150 text-center">
          <div
            className={`${reveal} mb-[1.7rem] text-[0.74rem] tracking-[0.26em] text-(--accent) uppercase`}
            style={{ animationDelay: "0.1s" }}
          >
            {eyebrow}
          </div>
          <div
            className={`${reveal} text-[clamp(3.2rem,9vw,6rem)] leading-none font-bold tracking-[-0.04em] text-(--accent) [text-shadow:0_0_52px_var(--glow)]`}
            style={{ animationDelay: "0.19s" }}
          >
            {code}
          </div>
          <h1
            className={`${reveal} mt-[1.4rem] text-[clamp(1.3rem,2.7vw,2.05rem)] leading-[1.1] font-bold tracking-[-0.01em] uppercase`}
            style={{ animationDelay: "0.28s" }}
          >
            {title}
          </h1>
          <p
            className={`${reveal} mx-auto mt-4 max-w-[46ch] text-[clamp(0.88rem,1.15vw,1.02rem)] leading-[1.65] text-(--dim)`}
            style={{ animationDelay: "0.37s" }}
          >
            {message}
          </p>
          <div
            className={`${reveal} mt-[2.4rem] flex flex-wrap items-center justify-center gap-[1.4rem]`}
            style={{ animationDelay: "0.46s" }}
          >
            {actions}
          </div>
        </div>
      </main>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-3 flex justify-between px-8 py-6 text-[0.72rem] tracking-[0.16em] text-(--dim) uppercase">
        <span>
          STATUS: <span className="text-(--accent)">{statusTag}</span>
        </span>
        <span>OTTERDEPLOY PLATFORM</span>
      </footer>
    </div>
  );
}
