/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

/**
 * The one shared brand shell every otterdeploy email renders through, so the
 * whole system speaks "one coherent vocabulary" (DESIGN.md). North star is "The
 * Quiet Instrument": warm-neutral monochrome, a single blue accent used
 * sparingly, flat hairline borders, generous rhythm. Every template MUST be a
 * React Email component — we never hand-author HTML strings.
 *
 * Structure is deliberately email-client-safe: a fixed 600px column on a warm
 * canvas, wordmark above a white content card, contextual footer below. All
 * layout goes through React Email primitives (which emit tables), so it holds
 * up in Outlook/Gmail/Apple Mail. We design for light only and declare it, so
 * clients don't aggressively invert our palette.
 */

// The design tokens live in apps/web/src/index.css as OKLCH; email clients
// don't grok OKLCH, so these are the sRGB equivalents. Keep them in sync.
export const brand = {
  ink: "#141412", // --foreground, headings
  body: "#33332e", // body copy — a touch softer than pure ink, still AA on white
  canvas: "#f3f3f0", // warm page ground so the white card lifts off it
  surface: "#ffffff", // the content card
  muted: "#6b6b63", // secondary / footnote text (AA on white and on canvas)
  faint: "#9a9a90", // footer meta
  hairline: "#e7e7e2", // foreground @ ~10%
  hairlineStrong: "#dcdcd5",
  accent: "#2b50e2", // --primary (the one blue), flattened to sRGB
  accentSoft: "#eef1fd", // accent @ ~8% — link/info wash
} as const;

export type NotificationSeverity = "info" | "ok" | "warn" | "err";

// Severity palette mirrors DESIGN.md's semantic tokens so a notification reads
// the same in email as it does in the app and in Slack/Discord.
export const SEVERITY: Record<
  NotificationSeverity,
  { label: string; fg: string; bg: string; border: string }
> = {
  err: { label: "Failed", fg: "#b42318", bg: "#fdf2f0", border: "#f1cec8" },
  warn: { label: "Warning", fg: "#8a6a00", bg: "#fdf8ea", border: "#ecdca6" },
  ok: { label: "Success", fg: "#1f7a3f", bg: "#eef8f1", border: "#c3e6cf" },
  info: { label: "Update", fg: "#1f5fa8", bg: "#eef3fb", border: "#c9dbf1" },
} as const;

export const tailwindConfig = {
  theme: {
    extend: {
      colors: {
        ink: brand.ink,
        body: brand.body,
        canvas: brand.canvas,
        surface: brand.surface,
        muted: brand.muted,
        faint: brand.faint,
        hairline: brand.hairline,
        hairlineStrong: brand.hairlineStrong,
        accent: brand.accent,
        accentSoft: brand.accentSoft,
      },
      fontFamily: {
        sans: [
          "Geist",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
} as const;

interface EmailLayoutProps {
  /** Inbox preview line (hidden in the body). */
  preview: string;
  /** Contextual footer note ("You're receiving this because…"). Defaults to a
   *  generic account line; pass `null` to omit. */
  footnote?: ReactNode | null;
  children: ReactNode;
}

/** The brand lockup: an ink chip with a blue core + the wordmark. Renders as a
 *  table so it survives every client. */
function Wordmark() {
  const chip: CSSProperties = {
    width: "30px",
    height: "30px",
    borderRadius: "8px",
    backgroundColor: brand.ink,
    textAlign: "center",
    verticalAlign: "middle",
  };
  const core: CSSProperties = {
    display: "inline-block",
    width: "11px",
    height: "11px",
    borderRadius: "3px",
    backgroundColor: brand.accent,
  };
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td style={chip}>
            <span style={core} />
          </td>
          <td style={{ paddingLeft: "10px", verticalAlign: "middle" }}>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: brand.ink,
              }}
            >
              otterdeploy
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Wraps content in the branded card + footer. Compose templates as
 *  `<EmailLayout preview="…">…</EmailLayout>`. */
export function EmailLayout({ preview, footnote, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind config={tailwindConfig}>
        <Body className="bg-canvas m-0 py-10 font-sans">
          <Container className="mx-auto w-full max-w-[600px] px-6">
            <Section className="px-1 pb-5">
              <Wordmark />
            </Section>

            <Section className="border-hairline bg-surface rounded-2xl border border-solid px-10 py-9">
              {children}
            </Section>

            <Section className="px-2 pt-6">
              {footnote === undefined ? (
                <Text className="m-0 text-[12px] leading-5 text-faint">
                  You&apos;re receiving this because you have an otterdeploy account.
                </Text>
              ) : footnote ? (
                <Text className="m-0 text-[12px] leading-5 text-faint">{footnote}</Text>
              ) : null}
              <Text className="m-0 mt-2 text-[12px] leading-5 text-faint">
                otterdeploy — calm, confident infrastructure.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

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
