/**
 * Country flag as an SVG from `country-flag-icons`. Not emoji: emoji flags
 * are regional-indicator pairs and Windows ships no glyphs for them: every
 * flag degrades to two letters there, so the column would be decorative on
 * macOS and broken everywhere else.
 *
 * Falls back to a code chip rather than a blank: a non-ISO key ("other")
 * still has to occupy the column so rows stay aligned.
 */

import type { ComponentType } from "react";

import * as CountryFlags from "country-flag-icons/react/3x2";

const FLAGS: Record<string, ComponentType<{ title?: string; className?: string }> | undefined> =
  CountryFlags;

export function CountryFlag({ code }: { code: string }) {
  const Flag = /^[A-Z]{2}$/.test(code) ? FLAGS[code] : undefined;
  if (!Flag) {
    return (
      <span className="w-[18px] shrink-0 text-center font-mono text-[9px] text-muted-foreground">
        {code === "other" ? "·" : code}
      </span>
    );
  }
  return (
    <span className="inline-flex w-[18px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-foreground/10">
      <Flag className="block h-auto w-full" />
    </span>
  );
}
