/**
 * A small, dependency-free Markdown renderer for the constrained markdown that
 * GitHub release notes (and similar short bodies) actually use: headings,
 * paragraphs, bullet / numbered lists, blockquotes, fenced + inline code,
 * links, bold / italic / strikethrough, and horizontal rules.
 *
 * It builds React elements directly (it NEVER touches dangerouslySetInnerHTML)
 * so untrusted release bodies can't inject markup, and link hrefs are limited to
 * http(s)/mailto. It's deliberately not a full CommonMark implementation: no
 * tables, no nested lists, no reference links. Reach for `react-markdown` if a
 * surface ever needs the whole spec.
 */
import { type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

// ── Inline ────────────────────────────────────────────────────────────────

// Earliest-match wins (regex exec finds the lowest index); on an index tie the
// first alternative wins, so code and links are matched before emphasis, and
// `**` before `*`.
const INLINE =
  /(`[^`]+`)|(\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(~~[^~]+~~)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(https?:\/\/[^\s)]+)/;

/** Only allow safe link schemes. A release body is untrusted input. */
function safeHref(href: string): string | undefined {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : undefined;
}

function link(href: string, children: ReactNode, key: number) {
  const safe = safeHref(href);
  if (!safe) return <span key={key}>{children}</span>;
  return (
    <a
      key={key}
      href={safe}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </a>
  );
}

// GitHub's own renderer collapses a same-repo link to `#154`, but the raw body
// from `gh release create --generate-notes` carries it in full: every entry
// reads `… by @someone in https://github.com/owner/repo/pull/154`. Rendered
// literally that is one wrapped line of accent-blue URL per merged PR, which on
// a six-PR release makes the link the loudest thing in a panel that should read
// as a quiet list. Only the LABEL is shortened — the href is untouched.
const GH_PULL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)$/;
const GH_COMPARE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/compare\/(\S+)$/;
const GH_COMMIT = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/([0-9a-f]{7,40})$/;

/** Display label for a bare (auto-linked) URL.
 *
 *  `repo` is the "owner/name" the body belongs to: links INTO it shorten to
 *  `#154`, links anywhere else keep the `owner/name#154` qualifier so a foreign
 *  reference can never be misread as a local one. With no `repo` given every
 *  reference stays qualified — ambiguity is worse than length. Anything that
 *  isn't a recognized GitHub permalink renders as the URL itself. */
function autolinkLabel(url: string, repo: string | undefined): string {
  const pull = GH_PULL.exec(url);
  if (pull) return pull[1] === repo ? `#${pull[2]}` : `${pull[1]}#${pull[2]}`;
  const compare = GH_COMPARE.exec(url);
  if (compare) return compare[2];
  const commit = GH_COMMIT.exec(url);
  if (commit) return commit[2].slice(0, 7);
  return url;
}

/** Turn one line of markdown into inline React nodes. Recurses for emphasis so
 *  `**bold _and italic_**` nests; code and link URLs stay literal. */
function parseInline(text: string, repo: string | undefined, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyPrefix}${i++}`;
    const [full, code, mdLink, bold, strike, italic, url] = m;
    if (code) {
      out.push(
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (mdLink) {
      const close = mdLink.indexOf("](");
      const label = mdLink.slice(1, close);
      const href = mdLink.slice(close + 2, -1);
      out.push(link(href, parseInline(label, repo, `${key}-`), i));
    } else if (bold) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {parseInline(bold.slice(2, -2), repo, `${key}-`)}
        </strong>,
      );
    } else if (strike) {
      out.push(
        <s key={key} className="text-muted-foreground">
          {parseInline(strike.slice(2, -2), repo, `${key}-`)}
        </s>,
      );
    } else if (italic) {
      out.push(
        <em key={key} className="italic">
          {parseInline(italic.slice(1, -1), repo, `${key}-`)}
        </em>,
      );
    } else if (url) {
      out.push(link(url, autolinkLabel(url, repo), i));
    }
    rest = rest.slice(m.index + full.length);
  }
  return out;
}

// ── Block ─────────────────────────────────────────────────────────────────

// Keyed by heading depth (1-6, guaranteed by the `#{1,6}` regex below), so the
// element name comes from a typed table instead of a template-string assertion.
const HEADING_TAG: Record<number, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
};

const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 mb-2 text-base font-semibold text-foreground first:mt-0",
  2: "mt-4 mb-2 text-sm font-semibold text-foreground first:mt-0",
  3: "mt-3 mb-1.5 text-[13px] font-semibold text-foreground first:mt-0",
  4: "mt-3 mb-1.5 text-[13px] font-semibold text-foreground/90 first:mt-0",
  5: "mt-3 mb-1.5 text-xs font-semibold text-foreground/90 first:mt-0",
  6: "mt-3 mb-1.5 text-xs font-semibold text-muted-foreground first:mt-0",
};

const isBlank = (l: string) => l.trim() === "";
const ulItem = /^\s*[-*+]\s+(.*)$/;
const olItem = /^\s*(\d+)\.\s+(.*)$/;
const heading = /^(#{1,6})\s+(.*)$/;
const hr = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const fence = /^\s*```/;

/** Parse the whole body into block-level React elements. */
function parseBlocks(src: string, repo: string | undefined): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block: collect verbatim until the closing fence.
    if (fence.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !fence.test(lines[i])) body.push(lines[i++]);
      i++; // consume closing fence (or EOF)
      blocks.push(
        <pre
          key={k()}
          className="my-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/80"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const h = heading.exec(line);
    if (h) {
      const level = h[1].length;
      const Tag = HEADING_TAG[level] ?? "h6";
      blocks.push(
        <Tag key={k()} className={HEADING_CLASS[level]}>
          {parseInline(h[2], repo)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (hr.test(line)) {
      blocks.push(<hr key={k()} className="my-3 border-border" />);
      i++;
      continue;
    }

    // Blockquote: consecutive `>` lines.
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={k()} className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
          {parseInline(quote.join(" "), repo)}
        </blockquote>,
      );
      continue;
    }

    // Lists: a run of consecutive bullet or numbered items.
    if (ulItem.test(line) || olItem.test(line)) {
      const ordered = olItem.test(line);
      const items: ReactNode[] = [];
      const matcher = ordered ? olItem : ulItem;
      let im = matcher.exec(lines[i]);
      while (im) {
        items.push(
          <li key={items.length} className="pl-1">
            {parseInline(ordered ? im[2] : im[1], repo)}
          </li>,
        );
        i++;
        im = i < lines.length ? matcher.exec(lines[i]) : null;
      }
      blocks.push(
        ordered ? (
          <ol key={k()} className="my-2 list-decimal space-y-1 pl-5 text-foreground/90">
            {items}
          </ol>
        ) : (
          <ul key={k()} className="my-2 list-disc space-y-1 pl-5 text-foreground/90">
            {items}
          </ul>
        ),
      );
      continue;
    }

    // Paragraph: gather consecutive plain lines until a blank or a block start.
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !heading.test(lines[i]) &&
      !hr.test(lines[i]) &&
      !fence.test(lines[i]) &&
      !ulItem.test(lines[i]) &&
      !olItem.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k()} className="my-2 leading-relaxed text-foreground/90 first:mt-0 last:mb-0">
        {parseInline(para.join(" "), repo)}
      </p>,
    );
  }

  return blocks;
}

/** GitHub release bodies (release-drafter, `gh release create --generate-notes`,
 *  etc.) commonly carry HTML comments. Tool markers, not content. Strip them
 *  before block parsing so they never surface as literal paragraph text. */
function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Render a markdown string as styled React elements. `className` is applied to
 * the wrapper. Empty / whitespace-only input renders nothing.
 *
 * `repo` ("owner/name") is the repository the body came from; pass it to get
 * GitHub's own `#154` shorthand for links back into it. See `autolinkLabel`.
 */
export function Markdown({
  children,
  className,
  repo,
}: {
  children: string;
  className?: string;
  repo?: string;
}) {
  const trimmed = stripHtmlComments(children ?? "").trim();
  if (!trimmed) return null;
  return (
    <div className={cn("text-[12.5px] text-foreground/90", className)}>
      {parseBlocks(trimmed, repo)}
    </div>
  );
}
