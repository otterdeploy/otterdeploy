import type { MDXComponents } from "mdx/types";

import type { ComponentProps, ReactNode } from "react";

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { PackageManager } from "@/components/docs/package-manager";

// Prose overrides so the docs body reads with the same vocabulary as the rest
// of the product: tracked-tight sans headings, muted body text, hairline
// dividers, mono inline code, one accent on links. Fumadocs keeps its own code
// block (Shiki + copy button); everything visual it ships that broke a rule in
// DESIGN.md is replaced here or in styles/app.css.

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

function H2({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cx(
        "mt-12 mb-3 scroll-mt-20 text-[1.5rem] font-semibold tracking-[-0.02em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function H3({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cx(
        "mt-8 mb-2 scroll-mt-20 text-[1.125rem] font-semibold tracking-[-0.015em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function P({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cx("my-4 text-[0.95rem] leading-relaxed text-foreground/80", className)}
      {...props}
    />
  );
}

function A({ className, ...props }: ComponentProps<"a">) {
  // `--od-accent` rather than `--primary`: the primary token is tuned to sit
  // under near-white button text and measures ~2.2:1 as link text on the dark
  // canvas. See the docs-chrome block in styles/app.css.
  return (
    <a
      className={cx(
        "font-medium text-[var(--od-accent)] underline-offset-2 hover:underline",
        className,
      )}
      {...props}
    />
  );
}

function LI({ className, ...props }: ComponentProps<"li">) {
  // Keep Fumadocs' own list marker; only align the text with our muted body.
  return (
    <li
      className={cx(
        "text-[0.95rem] leading-relaxed text-foreground/80 marker:text-muted-foreground/60",
        className,
      )}
      {...props}
    />
  );
}

function Strong({ className, ...props }: ComponentProps<"strong">) {
  return <strong className={cx("font-semibold text-foreground", className)} {...props} />;
}

function HR({ className, ...props }: ComponentProps<"hr">) {
  return <hr className={cx("my-10 border-border", className)} {...props} />;
}

// ── Callout ────────────────────────────────────────────────────────────────

/**
 * Replaces Fumadocs' callout, which shipped three things DESIGN.md forbids: a
 * 2px coloured bar down the left edge (never intentional, use a full hairline
 * ring or a tonal tint), a resting `shadow-md`, and a lucide icon in a project
 * that uses Hugeicons everywhere.
 *
 * State is carried by an icon AND a title, not by colour alone, so it survives
 * a greyscale print and a colour-blind reader.
 */
type CalloutType = "info" | "warn" | "warning" | "error" | "success";

const CALLOUT = {
  info: { icon: InformationCircleIcon, tone: "text-info", tint: "bg-info/10" },
  warn: { icon: Alert02Icon, tone: "text-warning", tint: "bg-warning/10" },
  error: { icon: Alert02Icon, tone: "text-destructive", tint: "bg-destructive/10" },
  success: { icon: CheckmarkCircle02Icon, tone: "text-success", tint: "bg-success/10" },
} as const;

function Callout({
  type = "info",
  title,
  children,
  className,
  ...props
}: {
  type?: CalloutType;
  title?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentProps<"div">, "title">) {
  const meta = CALLOUT[type === "warning" ? "warn" : type] ?? CALLOUT.info;

  return (
    <div
      className={cx("my-5 flex gap-3 rounded-lg border border-border bg-card p-4", className)}
      {...props}
    >
      <span
        aria-hidden
        className={cx("mt-px grid size-6 shrink-0 place-items-center rounded-md", meta.tint)}
      >
        <HugeiconsIcon icon={meta.icon} strokeWidth={1.8} className={cx("size-4", meta.tone)} />
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-[0.875rem] font-medium text-foreground">{title}</p> : null}
        <div
          className={cx(
            "text-[0.9rem] leading-relaxed text-foreground/80 [&>p]:my-0 [&>p+p]:mt-2",
            title ? "mt-1.5" : undefined,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    h2: H2,
    h3: H3,
    p: P,
    a: A,
    li: LI,
    strong: Strong,
    hr: HR,
    Callout,
    PackageManager,
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
