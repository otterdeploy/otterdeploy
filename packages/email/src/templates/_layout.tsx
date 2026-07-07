/** @jsxImportSource react */
import type { ReactNode } from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

/**
 * The one shared brand shell every otterdeploy email renders through — so the
 * whole system speaks "one coherent vocabulary" (DESIGN.md). Warm-neutral
 * monochrome with a single blue accent; flat, hairline borders, Geist-first
 * type. Every template MUST be a React Email component — we never hand-author
 * HTML strings.
 */

// The design tokens live in apps/web/src/index.css as OKLCH; email clients
// don't grok OKLCH, so these are the sRGB equivalents. Keep them in sync.
export const brand = {
  ink: "#141412", // --foreground
  canvas: "#fbfbfa", // --background
  surface: "#ffffff",
  muted: "#7a7a74", // --muted-foreground
  hairline: "#e6e6e2", // foreground @ ~10%
  accent: "#2b50e2", // --primary (the one blue), flattened to sRGB
} as const;

export const tailwindConfig = {
  theme: {
    extend: {
      colors: {
        ink: brand.ink,
        canvas: brand.canvas,
        surface: brand.surface,
        muted: brand.muted,
        hairline: brand.hairline,
        accent: brand.accent,
      },
      fontFamily: {
        sans: [
          "Geist",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
} as const;

interface EmailLayoutProps {
  /** Inbox preview line (hidden in the body). */
  preview: string;
  children: ReactNode;
}

/** Wraps content in the branded card + footer. Compose templates as
 *  `<EmailLayout preview="…">…</EmailLayout>`. */
export function EmailLayout({ preview, children }: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind config={tailwindConfig}>
        <Body className="bg-canvas font-sans">
          <Container className="border-hairline bg-surface mx-auto my-10 max-w-[520px] rounded-xl border border-solid px-10 py-8">
            <Text className="text-ink m-0 text-sm font-semibold tracking-tight">otterdeploy</Text>
            <Hr className="border-hairline my-6" />
            {children}
            <Hr className="border-hairline my-8" />
            <Text className="m-0 text-xs leading-5 text-muted">
              otterdeploy — calm, confident infrastructure.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

/** A footnote paragraph in the muted voice (e.g. "ignore this email"). */
export function Footnote({ children }: { children: ReactNode }) {
  return <Text className="m-0 mt-6 text-xs leading-5 text-muted">{children}</Text>;
}

/** Section spacer used between blocks. */
export function Spacer() {
  return <Section className="h-4" />;
}

/** The one primary action button — solid ink, the calm default. */
export function BrandButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section className="my-7 text-center">
      <Button
        href={href}
        className="bg-ink inline-block rounded-lg px-6 py-3 text-sm font-semibold text-white no-underline"
      >
        {children}
      </Button>
    </Section>
  );
}
