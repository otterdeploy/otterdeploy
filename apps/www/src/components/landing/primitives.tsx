import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Tick02Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

// Shared building blocks for the landing page. Everything reads from the
// tokens in styles/app.css: flat surfaces, hairline rings, one blue.

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

// ── Buttons ────────────────────────────────────────────────────────────────

const BTN =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,translate] duration-200 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0";

export function PrimaryButton({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cx(BTN, "bg-primary text-primary-foreground hover:bg-primary/90")}
      {...rest}
    >
      {children}
    </a>
  );
}

export function OutlineButton({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cx(BTN, "border border-border bg-background text-foreground hover:bg-muted")}
      {...rest}
    >
      {children}
    </a>
  );
}

// ── Section shell ──────────────────────────────────────────────────────────

/** The page's one horizontal rhythm. Every band shares it, so the hairline
 *  rules that separate bands line up with the content inside them. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("mx-auto w-full max-w-[76rem] px-6 lg:px-10", className)}>{children}</div>
  );
}

/**
 * A band of the page. `tone="ink"` inverts onto the warm near-black surface by
 * re-scoping the theme variables, so children keep using `text-foreground` and
 * `border-border` and simply resolve to the inverted values.
 */
export function Band({
  id,
  tone = "canvas",
  className,
  children,
}: {
  id?: string;
  tone?: "canvas" | "ink";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cx(
        "scroll-mt-24 border-t border-border",
        tone === "ink" && "od-ink bg-background text-foreground",
        className,
      )}
    >
      {children}
    </section>
  );
}

// ── Section headline ───────────────────────────────────────────────────────

/**
 * A two-tone statement headline: the claim in ink, the payoff in the muted
 * tone. Both halves are full sentences — the page argues, it doesn't label.
 */
export function TwoTone({
  a,
  b,
  className,
}: {
  a: string;
  b: string;
  className?: string;
}) {
  return (
    <h2
      className={cx(
        "text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.03em] text-balance sm:text-[2.25rem]",
        className,
      )}
    >
      {a} <span className="text-muted-foreground">{b}</span>
    </h2>
  );
}

// ── Machine-readable atoms ─────────────────────────────────────────────────

/** A mono taxonomy label: the dashboard's voice for anything machine-made. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("font-mono text-[0.75rem] tracking-tight", className)}>{children}</span>
  );
}

/**
 * A state chip. Colour never travels alone: every chip carries a dot AND a
 * word, so it survives a colour-blind reader and a greyscale print.
 */
export function StateChip({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "success" | "warning" | "info";
  children: ReactNode;
}) {
  const dot = {
    muted: "bg-muted-foreground",
    success: "bg-success",
    warning: "bg-warning",
    info: "bg-info",
  }[tone];
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 font-mono text-[0.7rem] text-muted-foreground">
      <span className={cx("size-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

// ── Art field ──────────────────────────────────────────────────────────────

/**
 * The blue, grained panel a showcase visual floats on. It re-scopes the colour
 * tokens (see `.od-field` in styles/app.css), so the visual inside needs no
 * knowledge of where it landed. It keeps using `bg-card` and `text-foreground`
 * and comes out as dark glass on blue.
 */
export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "od-field overflow-hidden rounded-2xl p-5 sm:p-7 lg:p-9",
        // The one place this page uses a shadow: the field genuinely floats.
        "shadow-[0_24px_60px_-30px_rgba(20,20,18,0.55)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Visual frame ───────────────────────────────────────────────────────────

/**
 * The chrome every showcase visual sits in: a flat card with a hairline ring
 * and one header strip. Giving them all identical chrome is what makes five
 * different mini-interfaces read as five views of one product.
 */
export function VisualFrame({
  title,
  trailing,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cx("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="min-w-0 truncate font-mono text-[0.75rem] text-foreground">{title}</span>
        {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
      </div>
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

// ── Copy-to-clipboard command ──────────────────────────────────────────────

/**
 * A shell command with a copy button. The button reports what happened.
 * Copied, or "select it" when the clipboard API is unavailable (http origins,
 * locked-down browsers): rather than pretending it worked.
 */
export function CommandLine({
  command,
  label,
  className,
}: {
  command: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [command]);

  return (
    <div
      className={cx(
        "group flex items-center gap-3 rounded-lg border border-border bg-card py-2 pr-2 pl-3.5",
        className,
      )}
    >
      {label ? (
        <span className="hidden shrink-0 border-r border-border pr-3 font-mono text-[0.7rem] text-muted-foreground sm:block">
          {label}
        </span>
      ) : null}
      <code className="od-noscroll min-w-0 flex-1 overflow-x-auto font-mono text-[0.8125rem] whitespace-nowrap text-foreground">
        <span aria-hidden className="mr-2 text-muted-foreground select-none">
          $
        </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy: ${command}`}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-200 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px"
      >
        <HugeiconsIcon
          icon={state === "copied" ? Tick02Icon : Copy01Icon}
          className={cx("size-4", state === "copied" && "text-success")}
        />
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied to clipboard" : state === "failed" ? "Copy failed" : ""}
      </span>
      {state === "failed" ? (
        <span className="shrink-0 pr-1 font-mono text-[0.7rem] text-warning">select it</span>
      ) : null}
    </div>
  );
}
