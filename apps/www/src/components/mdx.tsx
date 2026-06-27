import type { MDXComponents } from "mdx/types";

import type { ComponentProps } from "react";

import defaultMdxComponents from "fumadocs-ui/mdx";

// Make the docs body read with the same vocabulary as the landing
// (readme-landing.tsx): tracking-tight sans headings, muted body text, hairline
// `border-border` section dividers, mono inline code, and the Signal Blue
// accent on links. Only the prose elements are overridden — Fumadocs keeps its
// own code-block (Shiki highlighting + copy button) and component set.

const cx = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

// Heading scale matches Better Auth's docs: large, tracking-tight, white.
function H2({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cx(
        "mt-12 mb-3 scroll-mt-20 text-2xl font-semibold tracking-tight text-foreground",
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
        "mt-8 mb-2 scroll-mt-20 text-lg font-semibold tracking-tight text-foreground",
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
  return (
    <a
      className={cx("font-medium text-primary underline-offset-2 hover:underline", className)}
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
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
