/**
 * Which glyph leads a breakdown row, by dimension: a flag for countries, the
 * UA icon for browser / OS / device / screen, a globe for referrer hosts,
 * nothing for paths and campaign strings. One table so the cards and the
 * See-all dialog agree.
 */

import type { BreakdownDimension } from "@otterdeploy/shared/analytics-filters";

import type { ReactNode } from "react";

import { GlobeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { CountryFlag } from "../country-flag";
import { UaIcon } from "../ua-icon";

/** Dimensions rendered in sans: their keys are names, not machine strings. */
const SANS_DIMENSIONS: ReadonlySet<BreakdownDimension> = new Set([
  "channel",
  "country",
  "browser",
  "os",
  "device",
  "language",
  "screen",
  "goal",
]);

export function isMonoDimension(dimension: BreakdownDimension): boolean {
  return !SANS_DIMENSIONS.has(dimension);
}

export function ReferrerGlyph() {
  return (
    <HugeiconsIcon
      icon={GlobeIcon}
      strokeWidth={1.5}
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}

export function leadingFor(
  dimension: BreakdownDimension,
): ((key: string) => ReactNode) | undefined {
  switch (dimension) {
    case "country":
      return (key) => <CountryFlag code={key} />;
    case "browser":
    case "os":
    case "device":
    case "screen":
      return (key) => <UaIcon kind={dimension} value={key} />;
    case "referrer":
      return () => <ReferrerGlyph />;
    default:
      return undefined;
  }
}
