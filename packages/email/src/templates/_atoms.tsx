/** @jsxImportSource react */
import type { ReactNode } from "react";

import { Button, Column, Hr, Link, Row, Section, Text } from "@react-email/components";

/**
 * The typographic + content atoms every template composes inside
 * {@link module:_layout.EmailLayout} — headings, paragraphs, buttons, badges,
 * data tables. Split from ./_layout (which keeps the tokens + shell) under the
 * file cap; ./_layout re-exports everything here so templates keep importing
 * from one place.
 */

/** Primary email heading. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text className="text-ink m-0 text-[22px] font-semibold leading-[28px] tracking-[-0.02em]">
      {children}
    </Text>
  );
}

/** A body paragraph. `tight` gives the first line after a heading a smaller top
 *  gap. */
export function Para({ children, tight }: { children: ReactNode; tight?: boolean }) {
  return (
    <Text className={`text-body m-0 text-[15px] leading-[25px] ${tight ? "mt-4" : "mt-5"}`}>
      {children}
    </Text>
  );
}

/** Quiet secondary line — expiry notes, etc. */
export function Muted({ children }: { children: ReactNode }) {
  return <Text className="m-0 mt-4 text-[13px] leading-5 text-muted">{children}</Text>;
}

/** The muted footnote at the end of a body block. */
export function Footnote({ children }: { children: ReactNode }) {
  return <Text className="m-0 mt-6 text-[13px] leading-5 text-muted">{children}</Text>;
}

/** Full hairline rule. */
export function Divider() {
  return <Hr className="border-hairline my-7 border-t border-solid" />;
}

/** The one primary action — solid ink, left-aligned to the content column. */
export function BrandButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section className="mt-7">
      <Button
        href={href}
        className="bg-ink inline-block rounded-[10px] px-6 py-[13px] text-center text-[15px] font-semibold text-white no-underline"
      >
        {children}
      </Button>
    </Section>
  );
}

/** The copy-the-URL fallback shown under a button, so the action works even
 *  when the button doesn't render. */
export function LinkFallback({ href }: { href: string }) {
  return (
    <Section className="mt-5">
      <Text className="m-0 text-[13px] leading-5 text-muted">
        Or copy and paste this link into your browser:
      </Text>
      <Text className="m-0 mt-1 text-[13px] leading-5">
        <Link href={href} className="text-accent break-all underline">
          {href}
        </Link>
      </Text>
    </Section>
  );
}

/** A large monospaced one-time code inside a bordered inset. */
export function CodePanel({ code }: { code: string }) {
  return (
    <Section className="border-hairlineStrong my-7 rounded-xl border border-solid bg-[#fafaf8] py-6 text-center">
      <Text className="text-ink m-0 font-mono text-[34px] font-semibold leading-none tracking-[10px]">
        {code}
      </Text>
    </Section>
  );
}

/** A small pill badge (severity, role, etc.). */
export function Badge({
  children,
  fg,
  bg,
  border,
}: {
  children: ReactNode;
  fg: string;
  bg: string;
  border: string;
}) {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              backgroundColor: bg,
              border: `1px solid ${border}`,
              borderRadius: "999px",
              padding: "4px 11px",
            }}
          >
            <span
              style={{
                color: fg,
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {children}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** A key/value context table inside a subtle panel. Values are already
 *  presentation strings — the caller formats them, not this view.
 *
 *  The fill lives on the rounded container itself (an element's own background
 *  is clipped by its border-radius); the cells stay transparent. Never shade a
 *  child cell — `overflow-hidden` doesn't clip table cells in email clients, so
 *  a filled square cell would poke through the rounded corners. */
export function DataTable({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return null;
  return (
    <Section className="border-hairline mt-6 rounded-xl border border-solid bg-[#fafaf8]">
      {rows.map(([key, value], i) => (
        <Row key={key} className={i === 0 ? "" : "border-hairline border-t border-solid"}>
          <Column className="px-4 py-3 align-top" style={{ width: "38%" }}>
            <Text className="m-0 font-mono text-[11px] uppercase leading-4 tracking-wide text-muted">
              {key}
            </Text>
          </Column>
          <Column className="px-4 py-3 align-top">
            <Text className="text-ink m-0 break-words font-mono text-[12px] leading-4">{value}</Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}
